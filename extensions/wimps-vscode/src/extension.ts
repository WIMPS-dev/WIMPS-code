import * as vscode from 'vscode';
import type { JsMips, RegisterName as MipsRegisterName } from '@specy/mips';
import type { JsRiscV, RegisterName as RiscvRegisterName } from '@specy/risc-v';

let latestSimState: SimStateMessage | undefined;
let hasActiveAssemblyFile = false;
let activeAssemblyFileName = '';
type StateRefreshTarget = { refresh(): void };
const stateViews = new Set<StateRefreshTarget>();
const debugAdapters = new Set<WimpsDebugAdapter>();
let diagnostics: vscode.DiagnosticCollection;
let outputChannel: vscode.OutputChannel;
let architectureStatusBarItem: vscode.StatusBarItem;
let extensionContext: vscode.ExtensionContext | undefined;
let lastOutputText = '';
let bitmapDisplaySettings: BitmapDisplaySettings = {
  startAddress: 0x10010000,
  width: 64,
  height: 64,
  scale: 4,
};
let cacheConfig: CacheConfig = {
  cacheBytes: 1024,
  blockBytes: 16,
  associativity: 1,
};
let activeAssemblyRefreshTimers: ReturnType<typeof setTimeout>[] = [];

type RunAction = 'assemble' | 'run';
type Architecture = 'mips' | 'riscv' | 'x86';
type InputKind = 'int' | 'float' | 'double' | 'string' | 'char';
type RunResult = 'stopped' | 'breakpoint' | 'target' | 'terminated' | 'waiting' | 'limit' | 'not-assembled' | 'no-history';
type PendingInput = {
  kind: InputKind;
  value: string;
};

type SimRegister = {
  name: string;
  number: number;
  hexValue: string;
  decimalValue?: string;
};

type SimStateMessage = {
  type: 'wimps.simState';
  architecture: Architecture;
  architectureLabel: string;
  fileName: string;
  pc: string;
  registers: SimRegister[];
  specialRegisters: SimSpecialRegister[];
  memory: SimMemoryWord[];
  bitmap: SimBitmap;
  program: SimProgramRow[];
  symbols: SimSymbolRow[];
  cache: SimCacheAnalysis;
  stats: Record<InstrCategory, number>;
  totalInstructions: number;
  output: string;
  canStepBack: boolean;
  status: 'idle' | 'assembled' | 'running' | 'waiting' | 'terminated' | 'error' | 'limit';
};

type SimMemoryWord = {
  address: string;
  value: string;
};

type SimSpecialRegister = {
  name: string;
  value: string;
  detail?: string;
};

type SimBitmap = {
  startAddress: string;
  colors: string[];
};

type SimProgramRow = {
  address: string;
  binary: number;
  machine: string;
  assembly: string;
  sourceLine: number;
  source: string;
};

type SimSymbolRow = {
  label: string;
  address: string;
  segment: 'text' | 'data' | 'unknown';
};

type CacheAccess = {
  address: number;
  line: number | null;
  op: 'read' | 'write' | 'instruction';
  hit: boolean;
};

type CacheConfig = {
  cacheBytes: number;
  blockBytes: number;
  associativity: number;
};

type SimCacheAnalysis = {
  accesses: CacheAccess[];
  hits: number;
  misses: number;
  hitRate: number;
  sets: number;
  config: CacheConfig;
};

type BitmapDisplaySettings = {
  startAddress: number;
  width: number;
  height: number;
  scale: number;
};

type InstrCategory = 'arithmetic' | 'logic' | 'memory' | 'branch' | 'jump' | 'syscall' | 'other';
type InstructionDoc = {
  name: string;
  example: string;
  description: string;
};

const MIPS_REGISTER_NAMES = [
  '$zero','$at','$v0','$v1','$a0','$a1','$a2','$a3',
  '$t0','$t1','$t2','$t3','$t4','$t5','$t6','$t7',
  '$s0','$s1','$s2','$s3','$s4','$s5','$s6','$s7',
  '$t8','$t9','$k0','$k1','$gp','$sp','$fp','$ra',
] as const;
const RISCV_REGISTER_NAMES = [
  'zero','ra','sp','gp','tp','t0','t1','t2',
  's0','s1','a0','a1','a2','a3','a4','a5',
  'a6','a7','s2','s3','s4','s5','s6','s7',
  's8','s9','s10','s11','t3','t4','t5','t6',
] as const;
const X86_REGISTER_NAMES = [
  'rax','rbx','rcx','rdx','rsp','rbp','rsi','rdi',
  'r8','r9','r10','r11','r12','r13','r14','r15','rip',
] as const;
const X86_DATA_START_ADDRESS = 0x00400000;
const X86_WAITING_FOR_INPUT_STATUS = 2;

type X86RegisterName = (typeof X86_REGISTER_NAMES)[number];
type X86Emulator = {
  compile(source: string): Promise<{ ok: true; report: string } | { ok: false; report: string; errors: { line: number; error: string }[] }>;
  initialize(undoSize: number): void;
  dispose(): void;
  step(): Promise<{ terminated: boolean }>;
  run(limit?: number, breakpoints?: number[]): Promise<number>;
  undo(): void;
  canUndo(): boolean;
  writeMemoryBytes(address: bigint, data: Uint8Array): void;
  readMemoryBytes(address: bigint, length: bigint): Uint8Array;
  getCompiledCode(): { decorations: unknown[]; code: string };
  getStatus(): number;
  getNextInstruction(): { address: bigint; lineNumber: number; code: string } | null;
  getPc(): bigint;
  getSp(): bigint;
  getFlags(): { name: string; value: number; prev?: number }[];
  getRegisterValue(register: X86RegisterName): bigint;
  setRegisterValue(register: X86RegisterName, value: bigint): void;
  hasTerminated(): boolean;
  provideInput(line: string): void;
};

type ArchitectureDefinition = {
  id: Architecture;
  label: string;
  defaultFileName: string;
  dataStartAddress: number;
  registers: readonly string[];
};

const ARCHITECTURES: Record<Architecture, ArchitectureDefinition> = {
  mips: {
    id: 'mips',
    label: 'MIPS',
    defaultFileName: 'program.asm',
    dataStartAddress: 0x10010000,
    registers: MIPS_REGISTER_NAMES,
  },
  riscv: {
    id: 'riscv',
    label: 'RISC-V',
    defaultFileName: 'program.riscv',
    dataStartAddress: 0x10010000,
    registers: RISCV_REGISTER_NAMES,
  },
  x86: {
    id: 'x86',
    label: 'x86',
    defaultFileName: 'program.x86',
    dataStartAddress: X86_DATA_START_ADDRESS,
    registers: X86_REGISTER_NAMES,
  },
};

const ARITHMETIC_SET = new Set([
  'add','addi','addu','addiu','sub','subu','mul','mult','multu',
  'div','divu','mfhi','mflo','neg','negu','abs','rem','remu',
  'slt','slti','sltu','sltiu',
  'addw','addiw','subw','mulh','mulhsu','mulhu','divw','divuw','remw','remuw',
]);
const LOGIC_SET = new Set([
  'and','andi','or','ori','xor','xori','nor','not',
  'sll','srl','sra','sllv','srlv','srav','rol','ror',
  'slli','srli','srai','sllw','srlw','sraw','slliw','srliw','sraiw',
]);
const MEMORY_SET = new Set([
  'lw','sw','lb','lbu','lh','lhu','sh','sb','ll','sc',
  'lwl','lwr','swl','swr','la','li','lui','move','ulw','usw',
  'ldc1','sdc1','lwc1','swc1',
  'ld','sd','lwu','flw','fsw','fld','fsd','auipc',
]);
const BRANCH_SET = new Set([
  'beq','bne','blt','bgt','ble','bge','beqz','bnez',
  'bltz','bgtz','blez','bgez','bltzal','bgezal','bc1t','bc1f',
  'bltu','bgeu','bgtu','bleu',
]);
const JUMP_SET = new Set(['j','jr','jal','jalr','ret','call','tail']);
const X86_INSTRUCTION_DOCS = [
  'mov','lea','push','pop','add','sub','imul','mul','idiv','div','inc','dec','neg',
  'and','or','xor','not','shl','shr','sar','cmp','test','jmp','je','jne','jg','jge',
  'jl','jle','ja','jae','jb','jbe','call','ret','syscall','nop',
].map(name => ({ name, example: name, description: 'x86 instruction' }));
const RUN_LIMIT = 2_000_000;
const BITMAP_START_ADDRESS = 0x10010000;
const DATA_START_ADDRESS = 0x10010000;
const BITMAP_DEFAULT_WIDTH = 64;
const BITMAP_DEFAULT_HEIGHT = 64;
const BITMAP_MAX_PIXELS = 256 * 64;
const MIPS_EXTENSIONS = new Set(['.asm', '.s']);
const RISCV_EXTENSIONS = new Set(['.riscv', '.rv', '.rvasm']);
const X86_EXTENSIONS = new Set(['.x86']);
const ASM_EXTENSIONS = new Set([...MIPS_EXTENSIONS, ...RISCV_EXTENSIONS, ...X86_EXTENSIONS]);
const CLASSIC_READ_SYSCALLS = new Map<number, InputKind>([
  [5, 'int'],
  [6, 'float'],
  [7, 'double'],
  [8, 'string'],
  [12, 'char'],
]);
const DIALOG_READ_SYSCALLS = new Map<number, InputKind>([
  [51, 'int'],
  [52, 'float'],
  [53, 'double'],
  [54, 'string'],
]);
const RUN_YIELD_INTERVAL = 5_000;
const UNDO_SIZE = 100;
const CACHE_ACCESS_HISTORY_LIMIT = 10_000;
const DIRECTIVES = [
  '.text', '.data', '.globl', '.global', '.word', '.half', '.byte',
  '.ascii', '.asciiz', '.asciz', '.string', '.float', '.double',
  '.space', '.align', '.eqv', '.include', '.macro', '.end_macro',
] as const;
const instructionDocs = new Map<Architecture, Map<string, InstructionDoc>>();
type MipsModule = typeof import('@specy/mips');
type RiscvModule = typeof import('@specy/risc-v');
let simulatorModules: Promise<{ mips: MipsModule; riscv: RiscvModule }> | undefined;
let loadedSimulatorModules: { mips: MipsModule; riscv: RiscvModule } | undefined;

async function loadSimulatorModules(): Promise<{ mips: MipsModule; riscv: RiscvModule }> {
  if (!simulatorModules) {
    simulatorModules = Promise.all([
      import('@specy/mips'),
      import('@specy/risc-v'),
    ]).then(([mips, riscv]) => {
      loadedSimulatorModules = { mips, riscv };
      return loadedSimulatorModules;
    });
  }
  return simulatorModules;
}

async function getInstructionDocs(architecture: Architecture): Promise<Map<string, InstructionDoc>> {
  const cached = instructionDocs.get(architecture);
  if (cached) return cached;

  const docs = new Map<string, InstructionDoc>();
  const modules = await loadSimulatorModules();
  const rawInstructions = architecture === 'x86'
    ? X86_INSTRUCTION_DOCS
    : architecture === 'riscv'
      ? modules.riscv.RISCV.getInstructionSet()
      : modules.mips.MIPS.getInstructionSet();
  for (const instruction of rawInstructions) {
    const name = instruction.name?.trim();
    if (!name || docs.has(name.toLowerCase())) continue;
    docs.set(name.toLowerCase(), {
      name,
      example: instruction.example ?? '',
      description: instruction.description ?? '',
    });
  }
  instructionDocs.set(architecture, docs);
  return docs;
}

function labelsInDocument(document: vscode.TextDocument): { label: string; line: number }[] {
  const labels: { label: string; line: number }[] = [];
  for (let index = 0; index < document.lineCount; index++) {
    const text = document.lineAt(index).text.replace(/#.*$/, '');
    const match = text.match(/^\s*([A-Za-z_]\w*):/);
    if (match?.[1]) labels.push({ label: match[1], line: index + 1 });
  }
  return labels;
}

function registerCompletionNames(architecture: Architecture): string[] {
  if (architecture === 'x86') {
    return [...X86_REGISTER_NAMES];
  }
  if (architecture === 'riscv') {
    return [
      ...RISCV_REGISTER_NAMES,
      'fp',
      ...Array.from({ length: 32 }, (_unused, index) => `x${index}`),
    ];
  }
  return [...MIPS_REGISTER_NAMES];
}

function resolveRegisterName(name: string, architecture: Architecture): string {
  const normalized = name.trim();
  if (architecture === 'x86') {
    return normalized.toLowerCase();
  }
  if (architecture === 'riscv') {
    const xMatch = normalized.match(/^x([0-9]|[12][0-9]|3[01])$/i);
    if (xMatch) return RISCV_REGISTER_NAMES[Number(xMatch[1])] ?? normalized;
    if (normalized === 'fp') return 's0';
    return normalized;
  }

  const numeric = normalized.match(/^\$([0-9]|[12][0-9]|3[01])$/);
  if (numeric) return MIPS_REGISTER_NAMES[Number(numeric[1])] ?? normalized;
  return normalized.startsWith('$') ? normalized : `$${normalized}`;
}

function currentInstructionToken(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  const range = document.getWordRangeAtPosition(position, /[$.]?[A-Za-z_][\w.]*/);
  return range ? document.getText(range) : undefined;
}

function stripAssemblyComment(line: string): string {
  let inDouble = false;
  let inSingle = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const previous = line[index - 1];
    if (char === '"' && previous !== '\\' && !inSingle) inDouble = !inDouble;
    else if (char === '\'' && previous !== '\\' && !inDouble) inSingle = !inSingle;
    else if (char === '#' && !inDouble && !inSingle) return line.slice(0, index);
  }
  return line;
}

function parseWordLiteral(input: string): number | null {
  const parsed = parseIntegerInput(input);
  return parsed === null ? null : Number(parsed & 0xffffffffn);
}

function formatWordValue(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
}

function memoryDirectiveSize(rest: string): number {
  const trimmed = rest.trim();
  if (!trimmed) return 4;
  const directive = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
  const args = trimmed.slice(directive.length).trim();
  if (directive === '.space' || directive === '.zero') return parseWordLiteral(args.split(/[\s,]+/)[0] ?? '0') ?? 0;

  const stringBytes = (args.match(/"([^"\\]|\\.)*"/g) ?? []).reduce((sum, token) => {
    const inner = token.slice(1, -1);
    return sum + inner.replace(/\\./g, '_').length;
  }, 0);
  const numericCount = (args.match(/-?0x[\da-f]+|-?0b[01]+|-?\d+/gi) ?? []).length;
  const count = Math.max(1, stringBytes || numericCount || 1);

  if (directive === '.byte' || directive === '.ascii') return count;
  if (directive === '.asciiz' || directive === '.asciz' || directive === '.string') return count + (stringBytes ? 1 : 0);
  if (directive === '.half' || directive === '.2byte') return count * 2;
  if (directive === '.double' || directive === '.dword' || directive === '.8byte') return count * 8;
  return count * 4;
}

function analyzeCache(accesses: Omit<CacheAccess, 'hit'>[], config: CacheConfig): SimCacheAnalysis {
  const blockBytes = Math.max(4, config.blockBytes || 16);
  const associativity = Math.max(1, config.associativity || 1);
  const sets = Math.max(1, Math.floor((config.cacheBytes || 1024) / blockBytes / associativity));
  const cache = Array.from({ length: sets }, () => [] as number[]);
  const analyzed = accesses.map(access => {
    const block = Math.floor((access.address >>> 0) / blockBytes);
    const setIndex = block % sets;
    const set = cache[setIndex];
    const existing = set.indexOf(block);
    const hit = existing !== -1;
    if (hit) set.splice(existing, 1);
    set.unshift(block);
    if (set.length > associativity) set.pop();
    return { ...access, hit };
  });
  const hits = analyzed.filter(access => access.hit).length;
  const misses = analyzed.length - hits;
  return {
    accesses: analyzed,
    hits,
    misses,
    hitRate: analyzed.length ? hits / analyzed.length : 0,
    sets,
    config: {
      cacheBytes: Math.max(4, config.cacheBytes || 1024),
      blockBytes,
      associativity,
    },
  };
}

function emptyStats(): Record<InstrCategory, number> {
  return { arithmetic: 0, logic: 0, memory: 0, branch: 0, jump: 0, syscall: 0, other: 0 };
}

function categorizeInstruction(mnemonic: string): InstrCategory {
  if (mnemonic === 'syscall' || mnemonic === 'ecall' || mnemonic === 'ebreak' || mnemonic === 'break') return 'syscall';
  if (ARITHMETIC_SET.has(mnemonic)) return 'arithmetic';
  if (LOGIC_SET.has(mnemonic)) return 'logic';
  if (MEMORY_SET.has(mnemonic)) return 'memory';
  if (BRANCH_SET.has(mnemonic)) return 'branch';
  if (JUMP_SET.has(mnemonic)) return 'jump';
  return 'other';
}

type SimInstance = JsMips | JsRiscV | X86Emulator;

async function createLegacySimulatorInstance(architecture: Exclude<Architecture, 'x86'>, source: string): Promise<JsMips | JsRiscV> {
  const modules = await loadSimulatorModules();
  return architecture === 'riscv'
    ? modules.riscv.RISCV.makeRiscVFromSource(source)
    : modules.mips.MIPS.makeMipsFromSource(source);
}

async function createSimulatorInstance(architecture: Architecture, source: string, output: (value: string) => void): Promise<SimInstance> {
  if (architecture === 'x86') {
    ensureNodeBuiltinModuleShim();
    const { assemblers, createX86Emulator } = await import('@specy/x86');
    return createX86Emulator({
      mode: {
        ...assemblers.NASM_trunk,
        binaries: {
          assembler: {
            ...assemblers.NASM_trunk.binaries.assembler,
            file: await readPackagedX86Asset('nasm.3.00.elf'),
          },
          linker: {
            ...assemblers.NASM_trunk.binaries.linker,
            file: await readPackagedX86Asset('gnu-ld.2.43.50.elf'),
          },
        },
      },
      callbacks: {
        stdout: (charCode: number) => output(String.fromCharCode(charCode)),
        stderr: (charCode: number) => output(String.fromCharCode(charCode)),
      },
    });
  }
  return createLegacySimulatorInstance(architecture, source);
}

async function readPackagedX86Asset(fileName: string): Promise<Uint8Array> {
  if (!extensionContext) throw new Error('WIMPS extension is not activated.');
  return vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionContext.extensionUri, 'resources', 'x86', fileName));
}

function ensureNodeBuiltinModuleShim() {
  const proc = (globalThis as any).process;
  if (!proc || typeof proc.getBuiltinModule === 'function') return;
  proc.getBuiltinModule = (name: string) => {
    if (typeof require === 'function') return require(name);
    throw new Error(`Cannot load Node built-in module ${name} in this environment.`);
  };
}

class NativeAssemblySimulator {
  private architecture: Architecture = 'mips';
  private instance: SimInstance | undefined;
  private source = '';
  private sourceLines: string[] = [];
  private uri: vscode.Uri | undefined;
  private documentVersion = -1;
  private fileName = 'No file';
  private output = '';
  private assembled = false;
  private finishedMessageEmitted = false;
  private pendingInputs: PendingInput[] = [];
  private waitingForInput: InputKind | null = null;
  private stats = emptyStats();
  private totalInstructions = 0;
  private memoryAccesses: Omit<CacheAccess, 'hit'>[] = [];
  private outputSnapshots: string[] = [];
  private statsSnapshots: { stats: Record<InstrCategory, number>; totalInstructions: number; memoryAccesses: Omit<CacheAccess, 'hit'>[] }[] = [];
  private syscallAddresses = new Set<number>();

  get currentUri() {
    return this.uri;
  }

  get isAssembled() {
    return this.assembled;
  }

  isCurrentDocument(document: vscode.TextDocument, architecture = getDocumentArchitecture(document)) {
    return this.assembled
      && this.architecture === architecture
      && this.uri?.toString() === document.uri.toString()
      && this.documentVersion === document.version;
  }

  async assemble(document: vscode.TextDocument, architecture: Architecture, options: { publish?: boolean } = {}): Promise<{ ok: true } | { ok: false; report: string; errors: any[] }> {
    const publish = options.publish ?? true;
    this.architecture = architecture;
    this.source = document.getText().replace(/\r\n?/g, '\n');
    this.sourceLines = this.source.split('\n');
    this.uri = document.uri;
    this.documentVersion = document.version;
    this.fileName = document.fileName.split(/[\\/]/).pop() ?? ARCHITECTURES[architecture].defaultFileName;
    this.resetRuntimeState();
    try {
      if (this.architecture === 'x86') {
        (this.instance as X86Emulator).dispose();
      }
    } catch {}
    this.instance = await createSimulatorInstance(architecture, this.source, value => { this.output += value; });
    const result = await this.compileCurrentSource();

    if (result.hasErrors) {
      this.assembled = false;
      if (publish) publishSimState(this.toState('error'));
      return { ok: false, report: result.report, errors: result.errors ?? [] };
    }

    this.initializeRuntime();
    this.registerHandlers();
    this.cacheRuntimeProgramMetadata();
    this.assembled = true;
    if (publish) publishSimState(this.toState('assembled'));
    return { ok: true };
  }

  restartCurrentAssembly(options: { publish?: boolean } = {}) {
    if (!this.assembled || !this.instance) return false;
    if (this.architecture === 'x86') return false;
    this.resetRuntimeState();
    this.initializeRuntime();
    this.registerHandlers();
    if (options.publish ?? true) publishSimState(this.toState('assembled'));
    return true;
  }

  async step(): Promise<RunResult> {
    if (!this.assembled || !this.instance) return 'not-assembled';
    if (this.isTerminated()) {
      publishSimState(this.toState('terminated'));
      return 'terminated';
    }
    if (!await this.prepareInputIfNeeded()) return 'waiting';
    this.snapshotBeforeStep();
    this.trackCurrentInstruction();
    const done = await this.stepInstance();
    if (done) this.appendProgramFinished();
    publishSimState(this.toState(done ? 'terminated' : 'running'));
    return done ? 'terminated' : 'stopped';
  }

  async runUntilBreak(breakpointLines: Set<number>, limit = RUN_LIMIT): Promise<RunResult> {
    if (!this.assembled || !this.instance) return 'not-assembled';

    if (breakpointLines.size === 0 && this.architecture !== 'x86') {
      return this.runFastUntilTerminated(limit);
    }

    this.clearUndoHistory();
    for (let i = 0; i < limit && !this.isTerminated(); i++) {
      if (breakpointLines.size > 0 && this.isAtBreakpoint(breakpointLines)) {
        publishSimState(this.toState('running'));
        return 'breakpoint';
      }
      if (!await this.prepareInputIfNeeded()) return 'waiting';
      this.trackCurrentInstruction();
      const steppedToTermination = await this.stepInstance();
      if (steppedToTermination) break;
      if (i > 0 && i % RUN_YIELD_INTERVAL === 0) await yieldToExtensionHost();
    }

    const done = this.isTerminated();
    if (done) {
      this.appendProgramFinished();
    } else {
      this.output += `${this.output && !this.output.endsWith('\n') ? '\n' : ''}=== WIMPS stopped after ${limit} instructions ===\n`;
    }
    publishSimState(this.toState(done ? 'terminated' : 'limit'));
    return done ? 'terminated' : 'limit';
  }

  reset() {
    this.assembled = false;
    this.source = '';
    this.sourceLines = [];
    this.documentVersion = -1;
    this.uri = undefined;
    this.fileName = 'No file';
    this.resetRuntimeState();
    this.instance = undefined;
    publishSimState(this.toState('idle'));
  }

  private resetRuntimeState() {
    this.output = '';
    this.pendingInputs = [];
    this.waitingForInput = null;
    this.stats = emptyStats();
    this.totalInstructions = 0;
    this.memoryAccesses = [];
    this.outputSnapshots = [];
    this.statsSnapshots = [];
    this.finishedMessageEmitted = false;
    this.syscallAddresses = new Set();
  }

  private async runFastUntilTerminated(limit: number): Promise<RunResult> {
    if (!this.instance) return 'not-assembled';
    const instance = this.instance as JsMips | JsRiscV;

    this.clearUndoHistory();
    let executed = 0;
    for (; executed < limit && !instance.terminated; executed++) {
      if (this.syscallAddresses.has(this.currentProgramCounter()) && !await this.prepareInputAtCurrentSyscall()) {
        return 'waiting';
      }
      instance.step();
      if (executed > 0 && executed % RUN_YIELD_INTERVAL === 0) await yieldToExtensionHost();
    }

    this.totalInstructions += executed;
    const done = instance.terminated;
    if (done) {
      this.appendProgramFinished();
    } else {
      this.output += `${this.output && !this.output.endsWith('\n') ? '\n' : ''}=== WIMPS stopped after ${limit} instructions ===\n`;
    }
    publishSimState(this.toState(done ? 'terminated' : 'limit'));
    return done ? 'terminated' : 'limit';
  }

  private async compileCurrentSource(): Promise<{ hasErrors: boolean; report: string; errors: any[] }> {
    if (this.architecture === 'x86') {
      const result = await (this.instance as X86Emulator).compile(this.source);
      return result.ok
        ? { hasErrors: false, report: result.report, errors: [] }
        : {
          hasErrors: true,
          report: result.report,
          errors: result.errors.map(error => ({
            lineNumber: error.line,
            columnNumber: 1,
            message: error.error,
          })),
        };
    }

    (this.instance as JsMips | JsRiscV).setUndoSize(UNDO_SIZE);
    const result = (this.instance as JsMips | JsRiscV).assemble();
    return {
      hasErrors: result.hasErrors,
      report: result.report,
      errors: result.errors ?? [],
    };
  }

  private initializeRuntime() {
    if (this.architecture === 'x86') {
      (this.instance as X86Emulator).initialize(UNDO_SIZE);
    } else {
      (this.instance as JsMips | JsRiscV).setUndoSize(UNDO_SIZE);
      (this.instance as JsMips | JsRiscV).initialize(true);
    }
  }

  private isTerminated(): boolean {
    return this.architecture === 'x86'
      ? (this.instance as X86Emulator).hasTerminated()
      : Boolean((this.instance as JsMips | JsRiscV).terminated);
  }

  private getPc(): bigint {
    return this.architecture === 'x86'
      ? (this.instance as X86Emulator).getPc()
      : BigInt((this.instance as JsMips | JsRiscV).programCounter >>> 0);
  }

  private async stepInstance(): Promise<boolean> {
    if (this.architecture === 'x86') {
      const result = await (this.instance as X86Emulator).step();
      return result.terminated;
    }

    (this.instance as JsMips | JsRiscV).step();
    return Boolean((this.instance as JsMips | JsRiscV).terminated);
  }

  private undoInstance() {
    (this.instance as any).undo();
  }

  async runUntilSourceLine(targetLine: number, limit = RUN_LIMIT): Promise<RunResult> {
    if (!this.assembled || !this.instance) return 'not-assembled';

    for (let i = 0; i < limit && !this.isTerminated(); i++) {
      const line = this.currentSourceLine();
      if (line === targetLine) {
        publishSimState(this.toState('running'));
        return 'target';
      }
      if (!await this.prepareInputIfNeeded()) return 'waiting';
      this.trackCurrentInstruction();
      const steppedToTermination = await this.stepInstance();
      if (steppedToTermination) break;
      if (i > 0 && i % RUN_YIELD_INTERVAL === 0) await yieldToExtensionHost();
    }

    const done = this.isTerminated();
    if (done) {
      this.appendProgramFinished();
    } else {
      this.output += `${this.output && !this.output.endsWith('\n') ? '\n' : ''}=== WIMPS stopped before reaching line ${targetLine} after ${limit} instructions ===\n`;
    }
    publishSimState(this.toState(done ? 'terminated' : 'limit'));
    return done ? 'terminated' : 'limit';
  }

  stepBack(): RunResult {
    if (!this.assembled || !this.instance) return 'not-assembled';
    if (this.outputSnapshots.length === 0 || this.statsSnapshots.length === 0) return 'no-history';

    const output = this.outputSnapshots.pop();
    const stats = this.statsSnapshots.pop();
    if (output === undefined || stats === undefined) return 'no-history';

    try {
      this.undoInstance();
      this.output = output;
      this.stats = stats.stats;
      this.totalInstructions = stats.totalInstructions;
      this.memoryAccesses = [...stats.memoryAccesses];
      this.waitingForInput = null;
      this.finishedMessageEmitted = false;
      publishSimState(this.toState('running'));
      return 'stopped';
    } catch {
      this.outputSnapshots.push(output);
      this.statsSnapshots.push(stats);
      return 'no-history';
    }
  }

  writeMemoryWord(address: number, value: number): boolean {
    if (!this.assembled || !this.instance) return false;
    try {
      const bytes = [
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ];
      if (this.architecture === 'x86') {
        (this.instance as X86Emulator).writeMemoryBytes(BigInt(address >>> 0), Uint8Array.from(bytes));
      } else {
        (this.instance as JsMips | JsRiscV).setMemoryBytes(address >>> 0, bytes);
      }
      publishSimState(this.toState('running'));
      return true;
    } catch {
      return false;
    }
  }

  async writeRegister(name: string, value: bigint): Promise<boolean> {
    if (!this.assembled || !this.instance) return false;
    try {
      if (this.architecture === 'x86') {
        (this.instance as X86Emulator).setRegisterValue(name as X86RegisterName, BigInt.asUintN(64, value));
      } else if (this.architecture === 'riscv') {
        const modules = loadedSimulatorModules ?? await loadSimulatorModules();
        const [high, low] = modules.riscv.bigintToHighLow(BigInt.asUintN(64, value));
        (this.instance as JsRiscV).setRegisterValue(name as RiscvRegisterName, high, low);
      } else {
        (this.instance as JsMips).setRegisterValue(name as MipsRegisterName, Number(BigInt.asUintN(32, value)));
      }
      publishSimState(this.toState('running'));
      return true;
    } catch {
      return false;
    }
  }

  refreshState() {
    if (!this.assembled) return;
    publishSimState(this.toState(latestSimState?.status ?? 'running'));
  }

  assemblerListing(): string {
    return this.getProgramRows()
      .map(row => `${row.address}\t${row.machine}\t${formatInstructionDisplay(row.assembly)}\t# ${row.sourceLine}: ${row.source}`)
      .join('\n');
  }

  memoryDump(startAddress = ARCHITECTURES[this.architecture].dataStartAddress, wordCount = 128): string {
    return this.readMemoryWords(startAddress, wordCount)
      .map(word => `${word.address}\t${word.value}`)
      .join('\n');
  }

  stackFrame() {
    return {
      id: 1,
      name: `${ARCHITECTURES[this.architecture].label}: ${this.fileName}`,
      line: this.currentSourceLine() ?? 1,
      column: 1,
      source: this.uri ? { name: this.fileName, path: debugSourcePath(this.uri) } : undefined,
    };
  }

  toState(status: SimStateMessage['status']): SimStateMessage {
    let pc = 0;
    try { pc = Number(this.getPc() & 0xffffffffn) >>> 0; } catch {}

    return {
      type: 'wimps.simState',
      architecture: this.architecture,
      architectureLabel: ARCHITECTURES[this.architecture].label,
      fileName: this.fileName,
      pc: `0x${pc.toString(16).padStart(8, '0').toUpperCase()}`,
      registers: ARCHITECTURES[this.architecture].registers.map((name, index) => {
        let value = 0;
        try { value = this.getRegisterValue(name) >>> 0; } catch {}
        return {
          name,
          number: index,
          hexValue: `0x${value.toString(16).padStart(8, '0').toUpperCase()}`,
          decimalValue: value.toString(10),
        };
      }),
      memory: this.readMemoryWords(ARCHITECTURES[this.architecture].dataStartAddress, 128),
      bitmap: this.readBitmap(bitmapDisplaySettings.startAddress, BITMAP_MAX_PIXELS),
      program: this.getProgramRows(),
      symbols: this.getSymbols(),
      specialRegisters: this.getSpecialRegisters(),
      cache: analyzeCache(this.memoryAccesses, cacheConfig),
      stats: { ...this.stats },
      totalInstructions: this.totalInstructions,
      output: this.output,
      canStepBack: this.outputSnapshots.length > 0,
      status,
    };
  }

  private async prepareInputIfNeeded(): Promise<boolean> {
    const kind = this.pendingInputKind();
    if (!kind || this.pendingInputs.length > 0) return true;

    this.waitingForInput = kind;
    publishSimState(this.toState('waiting'));
    const value = await requestProgramInput(kind, this.fileName);
    if (value === undefined) {
      publishSimState(this.toState('waiting'));
      return false;
    }

    this.pendingInputs.push({ kind, value });
    if (this.architecture === 'x86') {
      (this.instance as X86Emulator).provideInput(value);
      this.pendingInputs.pop();
    }
    this.waitingForInput = null;
    return true;
  }

  private pendingInputKind(): InputKind | null {
    if (!this.instance) return null;
    if (this.architecture === 'x86') {
      try {
        return (this.instance as X86Emulator).getStatus() === X86_WAITING_FOR_INPUT_STATUS ? 'string' : null;
      } catch {
        return null;
      }
    }
    try {
      const instance = this.instance as JsMips | JsRiscV;
      const stmt = instance.getStatementAtAddress(instance.programCounter);
      const mnemonic = stmt?.assemblyStatement?.trimStart().split(/[\s,	(]/)[0]?.toLowerCase();
      if (this.architecture === 'mips' && mnemonic !== 'syscall') return null;
      if (this.architecture === 'riscv' && mnemonic !== 'ecall') return null;
      const service = this.architecture === 'riscv'
        ? this.getRegisterValue('a7')
        : this.getRegisterValue('$v0');
      return readSyscallKind(this.architecture, service);
    } catch {
      return null;
    }
  }

  private prepareInputAtCurrentSyscall(): Promise<boolean> {
    const service = this.architecture === 'riscv'
      ? this.getRegisterValue('a7')
      : this.getRegisterValue('$v0');
    const kind = readSyscallKind(this.architecture, service);
    return this.prepareInputKind(kind);
  }

  private prepareInputKind(kind: InputKind | null): Promise<boolean> {
    if (!kind || this.pendingInputs.length > 0) return Promise.resolve(true);

    this.waitingForInput = kind;
    publishSimState(this.toState('waiting'));
    return requestProgramInput(kind, this.fileName).then(value => {
      if (value === undefined) {
        publishSimState(this.toState('waiting'));
        return false;
      }

      this.pendingInputs.push({ kind, value });
      this.waitingForInput = null;
      return true;
    });
  }

  private takeInput(fallback = ''): string {
    const input = this.pendingInputs.shift();
    if (input === undefined) {
      this.waitingForInput = this.waitingForInput ?? 'string';
      return fallback;
    }
    this.appendInputEcho(input);
    return input.value;
  }

  private appendInputEcho(input: PendingInput) {
    const label = input.kind === 'int' ? 'integer'
      : input.kind === 'float' ? 'float'
      : input.kind === 'double' ? 'double'
      : input.kind === 'char' ? 'character'
      : 'string';
    const value = input.kind === 'char' && input.value === '\n' ? '\\n' : input.value;
    this.output += `${this.output && !this.output.endsWith('\n') ? '\n' : ''}[stdin ${label}] ${value}\n`;
  }

  private currentSourceLine(): number | null {
    if (!this.instance) return null;
    try {
      if (this.architecture === 'x86') {
        const instruction = (this.instance as X86Emulator).getNextInstruction();
        return instruction?.lineNumber === undefined ? null : instruction.lineNumber + 1;
      }
      const instance = this.instance as JsMips | JsRiscV;
      const stmt = instance.getStatementAtAddress(instance.programCounter);
      return stmt?.sourceLine ?? null;
    } catch {
      return null;
    }
  }

  private currentProgramCounter(): number {
    try {
      if (!this.instance) return 0;
      return this.architecture === 'x86'
        ? Number((this.instance as X86Emulator).getPc() & 0xffffffffn) >>> 0
        : ((this.instance as JsMips | JsRiscV).programCounter ?? 0) >>> 0;
    } catch {
      return 0;
    }
  }

  private isAtBreakpoint(breakpointLines: Set<number>): boolean {
    const line = this.currentSourceLine();
    return line !== null && breakpointLines.has(line);
  }

  private trackCurrentInstruction() {
    if (!this.instance) return;
    try {
      const stmt = this.currentInstruction();
      if (!stmt) return;
      const mnemonic = stmt?.assemblyStatement?.trimStart().split(/[\s,\t(]/)[0]?.toLowerCase();
      if (!mnemonic) return;
      this.stats[categorizeInstruction(mnemonic)]++;
      this.totalInstructions++;
      this.recordMemoryAccess({ address: stmt.address >>> 0, line: stmt.sourceLine ?? null, op: 'instruction' });
      const memoryAccess = this.estimateMemoryAccess(stmt.assemblyStatement);
      if (memoryAccess) this.recordMemoryAccess({ ...memoryAccess, line: stmt.sourceLine ?? null });
    } catch {}
  }

  private recordMemoryAccess(access: Omit<CacheAccess, 'hit'>) {
    this.memoryAccesses.push(access);
    if (this.memoryAccesses.length > CACHE_ACCESS_HISTORY_LIMIT) {
      this.memoryAccesses.splice(0, this.memoryAccesses.length - CACHE_ACCESS_HISTORY_LIMIT);
    }
  }

  private snapshotBeforeStep() {
    if (this.outputSnapshots.length >= UNDO_SIZE) this.outputSnapshots.shift();
    if (this.statsSnapshots.length >= UNDO_SIZE) this.statsSnapshots.shift();
    this.outputSnapshots.push(this.output);
    this.statsSnapshots.push({
      stats: { ...this.stats },
      totalInstructions: this.totalInstructions,
      memoryAccesses: [...this.memoryAccesses],
    });
  }

  private clearUndoHistory() {
    this.outputSnapshots = [];
    this.statsSnapshots = [];
  }

  private appendProgramFinished() {
    if (this.finishedMessageEmitted) return;
    this.output += `${this.output && !this.output.endsWith('\n') ? '\n' : ''}=== Program finished ===\n`;
    this.finishedMessageEmitted = true;
  }

  private currentInstruction(): { address: number; sourceLine: number | null; assemblyStatement: string } | null {
    if (this.architecture === 'x86') {
      const instruction = (this.instance as X86Emulator).getNextInstruction();
      if (!instruction) return null;
      return {
        address: Number(instruction.address & 0xffffffffn) >>> 0,
        sourceLine: instruction.lineNumber + 1,
        assemblyStatement: instruction.code,
      };
    }

    const instance = this.instance as JsMips | JsRiscV;
    const statement = instance.getStatementAtAddress(instance.programCounter);
    return statement ? {
      address: statement.address,
      sourceLine: statement.sourceLine ?? null,
      assemblyStatement: statement.assemblyStatement,
    } : null;
  }

  private estimateMemoryAccess(assembly: string): Omit<CacheAccess, 'line' | 'hit'> | null {
    const mnemonic = assembly.trimStart().split(/[\s,\t(]/)[0]?.toLowerCase();
    if (!mnemonic || !/^(l|s|fl|fs)[a-z0-9.]*/.test(mnemonic)) return null;
    const match = assembly.match(/(-?(?:0x[\da-f]+|0b[01]+|\d+))?\((\$?[a-z][a-z0-9]*|\$[0-9]+|x[0-9]+)\)/i);
    if (!match) return null;
    const offset = parseWordLiteral(match[1] || '0') ?? 0;
    const base = this.getRegisterValue(resolveRegisterName(match[2], this.architecture));
    return { address: (base + offset) >>> 0, op: mnemonic.startsWith('s') || mnemonic.startsWith('fs') ? 'write' : 'read' };
  }

  private getRegisterValue(name: string): number {
    if (!this.instance) return 0;
    if (this.architecture === 'x86') {
      return Number((this.instance as X86Emulator).getRegisterValue(name as X86RegisterName) & 0xffffffffn) >>> 0;
    }
    if (this.architecture === 'riscv') {
      return (this.instance as JsRiscV).getRegisterValue(name as RiscvRegisterName) >>> 0;
    }
    return (this.instance as JsMips).getRegisterValue(name as MipsRegisterName) >>> 0;
  }

  private getSp(): bigint {
    if (this.architecture === 'x86') return (this.instance as X86Emulator).getSp();
    return BigInt(((this.instance as any).stackPointer ?? 0) >>> 0);
  }

  private readMemoryBytes(startAddr: number, byteCount: number): Uint8Array | number[] {
    return this.architecture === 'x86'
      ? (this.instance as X86Emulator).readMemoryBytes(BigInt(startAddr >>> 0), BigInt(byteCount))
      : (this.instance as JsMips | JsRiscV).readMemoryBytes(startAddr, byteCount);
  }

  private readMemoryWords(startAddr: number, wordCount: number): SimMemoryWord[] {
    if (!this.instance) return [];
    try {
      const bytes = this.readMemoryBytes(startAddr, wordCount * 4);
      return Array.from({ length: wordCount }, (_, index) => {
        const value =
          ((bytes[index * 4 + 3] << 24) |
           (bytes[index * 4 + 2] << 16) |
           (bytes[index * 4 + 1] << 8) |
           bytes[index * 4]) >>> 0;
        return {
          address: `0x${(startAddr + index * 4).toString(16).toUpperCase()}`,
          value: `0x${value.toString(16).padStart(8, '0').toUpperCase()}`,
        };
      });
    } catch {
      return [];
    }
  }

  private readBitmap(startAddr: number, count: number): SimBitmap {
    const colors: string[] = [];
    if (!this.instance) {
      for (let index = 0; index < count; index++) colors.push('#000000');
      return {
        startAddress: `0x${startAddr.toString(16).toUpperCase()}`,
        colors,
      };
    }
    try {
      const bytes = this.readMemoryBytes(startAddr, count * 4);
      for (let index = 0; index < count; index++) {
        const red = bytes[index * 4 + 2] ?? 0;
        const green = bytes[index * 4 + 1] ?? 0;
        const blue = bytes[index * 4] ?? 0;
        colors.push(`#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`);
      }
    } catch {
      for (let index = 0; index < count; index++) colors.push('#000000');
    }
    return {
      startAddress: `0x${startAddr.toString(16).toUpperCase()}`,
      colors,
    };
  }

  readBitmapDisplay(startAddr: number): SimBitmap {
    return this.readBitmap(startAddr, BITMAP_MAX_PIXELS);
  }

  private getProgramRows(): SimProgramRow[] {
    if (!this.instance) return [];
    try {
      if (this.architecture === 'x86') {
        return (this.instance as X86Emulator).getCompiledCode().code.split('\n').map((line, index) => ({
          address: '',
          binary: 0,
          machine: '',
          assembly: line.trim(),
          sourceLine: index + 1,
          source: this.sourceLines[index] ?? line,
        })).filter(row => row.assembly);
      }
      return (this.instance as JsMips | JsRiscV).getCompiledStatements().map((statement: any) => {
        const binary = statement.binaryStatement >>> 0;
        return {
          address: `0x${(statement.address >>> 0).toString(16).padStart(8, '0').toUpperCase()}`,
          binary,
          machine: `0x${binary.toString(16).padStart(8, '0').toUpperCase()}`,
          assembly: statement.assemblyStatement,
          sourceLine: statement.sourceLine,
          source: statement.source ?? '',
        };
      });
    } catch {
      return [];
    }
  }

  private cacheRuntimeProgramMetadata() {
    this.syscallAddresses = new Set();
    for (const row of this.getProgramRows()) {
      const mnemonic = row.assembly.trimStart().split(/[\s,\t(]/)[0]?.toLowerCase();
      if (this.architecture === 'mips' && mnemonic === 'syscall') {
        this.syscallAddresses.add(parseInt(row.address.slice(2), 16) >>> 0);
      } else if (this.architecture === 'riscv' && mnemonic === 'ecall') {
        this.syscallAddresses.add(parseInt(row.address.slice(2), 16) >>> 0);
      }
    }
  }

  private getSymbols(): SimSymbolRow[] {
    if (!this.instance) return this.getDataLabels();
    const rows = new Map<string, SimSymbolRow>();
    for (const statement of this.getProgramRows()) {
      let label: string | null = null;
      try {
        if (statement.address) {
          label = this.architecture === 'x86'
            ? null
            : (this.instance as JsMips | JsRiscV).getLabelAtAddress(parseInt(statement.address.slice(2), 16));
        }
      } catch {}
      if (label) {
        rows.set(`${label}:${statement.address}`, {
          label,
          address: statement.address,
          segment: 'text',
        });
      }
    }
    for (const row of this.getDataLabels()) rows.set(`${row.label}:${row.address}`, row);
    return [...rows.values()].sort((a, b) => parseInt(a.address.slice(2), 16) - parseInt(b.address.slice(2), 16) || a.label.localeCompare(b.label));
  }

  private getDataLabels(): SimSymbolRow[] {
    const rows: SimSymbolRow[] = [];
    let inData = false;
    let address = DATA_START_ADDRESS;
    for (const rawLine of this.sourceLines) {
      const line = stripAssemblyComment(rawLine).trim();
      if (!line) continue;
      if (line.startsWith('.data')) {
        inData = true;
        continue;
      }
      if (line.startsWith('.text')) {
        inData = false;
        continue;
      }
      if (!inData) continue;

      const label = line.match(/^([A-Za-z_]\w*):/);
      if (label?.[1]) rows.push({ label: label[1], address: formatWordValue(address), segment: 'data' });
      const rest = line.replace(/^([A-Za-z_]\w*):\s*/, '');
      address = (address + memoryDirectiveSize(rest)) >>> 0;
    }
    return rows;
  }

  private getSpecialRegisters(): SimSpecialRegister[] {
    let pc = 0;
    try { pc = Number(this.getPc() & 0xffffffffn); } catch {}
    const rows: SimSpecialRegister[] = [
      { name: 'pc', value: this.formatRegisterValue(pc), detail: 'Program counter' },
    ];
    if (!this.instance) return rows;
    try { rows.push({ name: 'sp', value: this.formatRegisterValue(Number(this.getSp() & 0xffffffffn)), detail: 'Stack pointer' }); } catch {}
    if (this.architecture === 'mips') {
      try { rows.push({ name: 'hi', value: this.formatRegisterValue((this.instance as JsMips).getHi()), detail: 'Multiply/divide high register' }); } catch {}
      try { rows.push({ name: 'lo', value: this.formatRegisterValue((this.instance as JsMips).getLo()), detail: 'Multiply/divide low register' }); } catch {}
    }
    try {
      if (this.architecture === 'x86') {
        for (const flag of (this.instance as X86Emulator).getFlags()) {
          rows.push({ name: flag.name, value: String(flag.value), detail: 'Condition flag' });
        }
      } else {
        const flags = (this.instance as JsMips | JsRiscV).getConditionFlags();
        flags.forEach((flag, index) => rows.push({
          name: `flag${index}`,
          value: String(flag),
          detail: 'Floating-point condition flag',
        }));
      }
    } catch {}
    return rows;
  }

  private formatRegisterValue(value: number): string {
    return formatWordValue(value >>> 0);
  }

  private registerHandlers() {
    if (!this.instance || this.architecture === 'x86') return;
    const instance = this.instance as any;
    instance.registerHandler('printInt', (value: any) => { this.output += String(value); });
    instance.registerHandler('printFloat', (value: any) => { this.output += String(value); });
    instance.registerHandler('printDouble', (value: any) => { this.output += String(value); });
    instance.registerHandler('printString', (value: any) => { this.output += String(value); });
    instance.registerHandler('printChar', (value: any) => { this.output += String(value); });
    instance.registerHandler('log', (value: any) => { this.output += String(value); });
    instance.registerHandler('logLine', (value: any) => { this.output += `${String(value)}\n`; });
    instance.registerHandler('stdOut', (bytes: number[]) => { this.output += bytes.map(byte => String.fromCharCode(byte)).join(''); });
    instance.registerHandler('stdIn', (buffer: number[], length: number) => {
      const inputBytes = Array.from(`${this.takeInput('')}\n`, char => char.charCodeAt(0) & 0xff);
      const count = Math.max(0, Math.min(length, buffer.length, inputBytes.length));
      for (let index = 0; index < count; index++) buffer[index] = inputBytes[index];
    });
    instance.registerHandler('readInt', () => parseInt(this.takeInput('0'), 10) || 0);
    instance.registerHandler('readFloat', () => parseFloat(this.takeInput('0')) || 0);
    instance.registerHandler('readDouble', () => parseFloat(this.takeInput('0')) || 0);
    instance.registerHandler('readString', () => this.takeInput(''));
    instance.registerHandler('readChar', () => this.takeInput('').charAt(0));
    instance.registerHandler('inputDialog', () => this.takeInput(''));
    instance.registerHandler('askInt', () => parseInt(this.takeInput('0'), 10) || 0);
    instance.registerHandler('askFloat', () => parseFloat(this.takeInput('0')) || 0);
    instance.registerHandler('askDouble', () => parseFloat(this.takeInput('0')) || 0);
    instance.registerHandler('askString', () => this.takeInput(''));
  }
}

const nativeSimulator = new NativeAssemblySimulator();

function publishSimState(state: SimStateMessage) {
  latestSimState = state;
  updateOutputChannel(state);
  for (const view of stateViews) view.refresh();
  for (const adapter of debugAdapters) adapter.onSimState(state);
}

function yieldToExtensionHost(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function requestProgramInput(kind: InputKind, fileName: string): Promise<string | undefined> {
  const label = kind === 'int' ? 'integer'
    : kind === 'float' ? 'float'
    : kind === 'double' ? 'double'
    : kind === 'char' ? 'character'
    : 'string';

  outputChannel.show(true);
  return vscode.window.showInputBox({
    title: `WIMPS input: ${fileName}`,
    prompt: `Enter ${label} for read ${kind} syscall.`,
    placeHolder: kind === 'char' ? 'A' : kind === 'string' ? 'text' : '0',
    validateInput: value => validateProgramInput(kind, value),
  });
}

function validateProgramInput(kind: InputKind, value: string): string | null {
  if (kind === 'string') return null;
  if (kind === 'char') return value.length === 1 ? null : 'Enter exactly one character.';
  if (kind === 'int') return /^[-+]?\d+$/.test(value.trim()) ? null : 'Enter an integer.';
  const trimmed = value.trim();
  return trimmed !== '' && Number.isFinite(Number(trimmed)) ? null : 'Enter a number.';
}

function readSyscallKind(architecture: Architecture, service: number): InputKind | null {
  const classic = CLASSIC_READ_SYSCALLS.get(service);
  if (classic) return classic;

  const dialog = DIALOG_READ_SYSCALLS.get(service);
  if (dialog) return dialog;

  if (architecture === 'riscv' && service === 63) return 'string';
  return null;
}

function updateOutputChannel(state: SimStateMessage) {
  if (!outputChannel) return;

  if (state.status === 'assembled' || state.status === 'error' || state.status === 'idle') {
    lastOutputText = '';
    outputChannel.clear();
    outputChannel.appendLine(`[${state.architectureLabel}: ${state.fileName}] ${state.status}`);
  }

  if (!state.output) return;

  if (state.output.startsWith(lastOutputText)) {
    const next = state.output.slice(lastOutputText.length);
    if (next) outputChannel.append(next);
  } else {
    outputChannel.clear();
    outputChannel.append(state.output);
  }
  lastOutputText = state.output;
}

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  diagnostics = vscode.languages.createDiagnosticCollection('wimps');
  outputChannel = vscode.window.createOutputChannel('WIMPS');
  architectureStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const assemblySelector: vscode.DocumentSelector = [
    { language: 'mips' },
    { language: 'riscv' },
    { language: 'x86' },
  ];
  const completionProvider = new AssemblyCompletionProvider();
  const hoverProvider = new AssemblyHoverProvider();
  const definitionProvider = new AssemblyDefinitionProvider();
  const symbolProvider = new AssemblyDocumentSymbolProvider();
  const registersView = new WimpsStateViewProvider('registers');
  const memoryView = new WimpsStateViewProvider('memory');
  const bitmapView = new WimpsStateViewProvider('bitmap');
  const programView = new WimpsStateViewProvider('program');
  const analysisView = new WimpsStateViewProvider('analysis');
  scheduleActiveAssemblyContextRefresh();
  context.subscriptions.push(
    diagnostics,
    outputChannel,
    architectureStatusBarItem,
    registersView,
    memoryView,
    bitmapView,
    programView,
    analysisView,
    vscode.languages.registerCompletionItemProvider(assemblySelector, completionProvider, '.', '$'),
    vscode.languages.registerHoverProvider(assemblySelector, hoverProvider),
    vscode.languages.registerDefinitionProvider(assemblySelector, definitionProvider),
    vscode.languages.registerDocumentSymbolProvider(assemblySelector, symbolProvider),
    vscode.commands.registerCommand('wimps.assembleCurrentFile', () => {
      return loadCurrentFileNative('assemble');
    }),
    vscode.commands.registerCommand('wimps.runCurrentFile', () => {
      return loadCurrentFileNative('run');
    }),
    vscode.commands.registerCommand('wimps.continueCurrentFile', () => {
      return continueCurrentFileNative();
    }),
    vscode.commands.registerCommand('wimps.stepCurrentFile', () => {
      return stepCurrentFileNative();
    }),
    vscode.commands.registerCommand('wimps.stepBackCurrentFile', () => {
      return stepBackCurrentFileNative();
    }),
    vscode.commands.registerCommand('wimps.runToCursor', () => {
      return runToCursorNative();
    }),
    vscode.commands.registerCommand('wimps.editMemoryWord', () => {
      return editMemoryWordNative();
    }),
    vscode.commands.registerCommand('wimps.editMemoryWordAtItem', (item?: WimpsTreeItem) => {
      return editMemoryWordNative(item);
    }),
    vscode.commands.registerCommand('wimps.setRegisterValue', () => {
      return setRegisterValueNative();
    }),
    vscode.commands.registerCommand('wimps.setRegisterValueAtItem', (item?: WimpsTreeItem) => {
      return setRegisterValueNative(item);
    }),
    vscode.commands.registerCommand('wimps.configureCache', () => {
      return configureCacheNative();
    }),
    vscode.commands.registerCommand('wimps.copyAssemblerListing', () => {
      return copyAssemblerListingNative();
    }),
    vscode.commands.registerCommand('wimps.copyMemoryDump', () => {
      return copyMemoryDumpNative();
    }),
    vscode.commands.registerCommand('wimps.resetSimulator', () => {
      nativeSimulator.reset();
      for (const view of stateViews) view.refresh();
      void revealWimpsTools();
    }),
    vscode.commands.registerCommand('wimps.openOutput', () => {
      outputChannel.show(true);
    }),
    vscode.commands.registerCommand('wimps.selectArchitecture', () => {
      return selectAssemblyArchitecture();
    }),
    vscode.commands.registerCommand('wimps.revealSourceLine', (line: number) => {
      return revealSourceLine(line);
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      scheduleActiveAssemblyContextRefresh();
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      scheduleActiveAssemblyContextRefresh();
    }),
    vscode.workspace.onDidOpenTextDocument(() => {
      scheduleActiveAssemblyContextRefresh();
    }),
    vscode.workspace.onDidCloseTextDocument(() => {
      scheduleActiveAssemblyContextRefresh();
    }),
    vscode.window.registerWebviewViewProvider('wimps.registers', registersView),
    vscode.window.registerWebviewViewProvider('wimps.memory', memoryView),
    vscode.window.registerWebviewViewProvider('wimps.bitmap', bitmapView),
    vscode.window.registerWebviewViewProvider('wimps.program', programView),
    vscode.window.registerWebviewViewProvider('wimps.analysis', analysisView),
    vscode.debug.registerDebugAdapterDescriptorFactory('wimps', {
      createDebugAdapterDescriptor() {
        const adapter = new WimpsDebugAdapter(context);
        return new vscode.DebugAdapterInlineImplementation(adapter);
      },
    }),
  );
}

export function deactivate() {}

async function loadCurrentFileNative(action: RunAction) {
  const document = getActiveAssemblyDocument();
  if (!document) {
    await vscode.window.showWarningMessage('Open a MIPS, RISC-V, or x86 assembly file first.');
    return false;
  }

  return loadDocumentNative(document, action);
}

async function ensureCurrentFileAssembled(): Promise<boolean> {
  const document = getActiveAssemblyDocument();
  if (!document) {
    await vscode.window.showWarningMessage('Open a MIPS, RISC-V, or x86 assembly file first.');
    return false;
  }

  const architecture = getDocumentArchitecture(document);
  if (nativeSimulator.isCurrentDocument(document, architecture)) {
    return true;
  }

  return loadDocumentNative(document, 'assemble');
}

async function revealWimpsTools() {
  await vscode.commands.executeCommand('workbench.view.extension.wimpsRegisters').then(undefined, () => undefined);
}

async function continueCurrentFileNative() {
  if (!await ensureCurrentFileAssembled()) return;
  const result = await nativeSimulator.runUntilBreak(new Set());
  await revealWimpsTools();
  outputChannel.show(true);
  if (result === 'not-assembled') await vscode.window.showWarningMessage('Assemble the file before continuing.');
}

async function stepCurrentFileNative() {
  if (!await ensureCurrentFileAssembled()) return;
  const result = await nativeSimulator.step();
  await revealWimpsTools();
  if (result === 'not-assembled') await vscode.window.showWarningMessage('Assemble the file before stepping.');
}

async function stepBackCurrentFileNative() {
  if (!await ensureCurrentFileAssembled()) return;
  const result = nativeSimulator.stepBack();
  await revealWimpsTools();
  if (result === 'no-history') await vscode.window.showInformationMessage('No previous instruction to step back to.');
  if (result === 'not-assembled') await vscode.window.showWarningMessage('Assemble the file before stepping back.');
}

async function runToCursorNative() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isAssemblyDocument(editor.document)) {
    await vscode.window.showWarningMessage('Open a MIPS, RISC-V, or x86 assembly file first.');
    return;
  }

  if (!await ensureCurrentFileAssembled()) return;
  const targetLine = editor.selection.active.line + 1;
  const result = await nativeSimulator.runUntilSourceLine(targetLine);
  await revealWimpsTools();
  outputChannel.show(true);

  if (result === 'limit') {
    await vscode.window.showWarningMessage(`WIMPS stopped before reaching line ${targetLine}.`);
  } else if (result === 'terminated') {
    await vscode.window.showInformationMessage(`Program terminated before reaching line ${targetLine}.`);
  }
}

async function editMemoryWordNative(target?: WimpsTreeItem | string | number) {
  if (!await ensureCurrentFileAssembled()) return;

  const state = visibleSimState();
  const targetAddress = typeof target === 'number' ? formatHex32(target)
    : typeof target === 'string' ? target
    : target?.memoryAddress;
  let addressText = targetAddress ?? state?.memory[0]?.address ?? `0x${BITMAP_START_ADDRESS.toString(16).toUpperCase()}`;
  if (!targetAddress) {
    const enteredAddress = await vscode.window.showInputBox({
      title: 'Edit Memory Word',
      prompt: 'Address to edit.',
      value: addressText,
      validateInput: value => parseIntegerInput(value) === null ? 'Enter a decimal, hexadecimal, or binary address.' : null,
    });
    if (enteredAddress === undefined) return;
    addressText = enteredAddress;
  }

  const valueText = await vscode.window.showInputBox({
    title: 'Edit Memory Word',
    prompt: `New 32-bit word value at ${addressText}.`,
    placeHolder: '0x00000000',
    validateInput: value => parseIntegerInput(value) === null ? 'Enter a decimal, hexadecimal, or binary word value.' : null,
  });
  if (valueText === undefined) return;

  const address = Number(parseIntegerInput(addressText)! & 0xffffffffn);
  const value = Number(parseIntegerInput(valueText)! & 0xffffffffn);
  if (!nativeSimulator.writeMemoryWord(address, value)) {
    await vscode.window.showErrorMessage(`Could not write memory at ${formatHex32(address)}.`);
  }
}

async function setRegisterValueNative(target?: WimpsTreeItem | string) {
  if (!await ensureCurrentFileAssembled()) return;

  const state = visibleSimState();
  const registers = state?.registers ?? [];
  const targetRegister = typeof target === 'string' ? target : target?.registerName;
  const selected = targetRegister
    ? registers.find(register => register.name === targetRegister)
    : await vscode.window.showQuickPick(registers.map(register => ({
    label: register.name,
    description: register.hexValue,
    detail: register.decimalValue,
  })), {
    title: 'Set Register Value',
    placeHolder: 'Choose a register to edit.',
  });
  if (!selected) return;

  const valueText = await vscode.window.showInputBox({
    title: 'Set Register Value',
    prompt: `New value for ${'label' in selected ? selected.label : selected.name}.`,
    value: 'description' in selected ? selected.description : selected.hexValue,
    validateInput: value => parseIntegerInput(value) === null ? 'Enter a decimal, hexadecimal, or binary value.' : null,
  });
  if (valueText === undefined) return;

  const value = parseIntegerInput(valueText)!;
  const registerName = 'label' in selected ? selected.label : selected.name;
  if (!await nativeSimulator.writeRegister(registerName, value)) {
    await vscode.window.showErrorMessage(`Could not write register ${registerName}.`);
  }
}

async function configureCacheNative() {
  const cacheBytes = await pickCacheNumber('Cache Size', [512, 1024, 2048, 4096, 8192], cacheConfig.cacheBytes, 'bytes');
  if (cacheBytes === undefined) return;
  const blockBytes = await pickCacheNumber('Block Size', [4, 8, 16, 32, 64], cacheConfig.blockBytes, 'bytes');
  if (blockBytes === undefined) return;
  const associativity = await pickCacheNumber('Associativity', [1, 2, 4, 8], cacheConfig.associativity, 'way');
  if (associativity === undefined) return;

  cacheConfig = { cacheBytes, blockBytes, associativity };
  nativeSimulator.refreshState();
  for (const view of stateViews) view.refresh();
}

async function pickCacheNumber(title: string, values: number[], current: number, unit: string): Promise<number | undefined> {
  const choice = await vscode.window.showQuickPick(values.map(value => ({
    label: `${value}`,
    description: value === current ? 'Current' : `${value} ${unit}${unit === 'way' && value > 1 ? 's' : ''}`,
    value,
  })), {
    title,
    placeHolder: `Choose ${title.toLowerCase()}.`,
  });
  return choice?.value;
}

async function copyAssemblerListingNative() {
  if (!await ensureCurrentFileAssembled()) return;
  const listing = nativeSimulator.assemblerListing();
  if (!listing) {
    await vscode.window.showInformationMessage('No assembled instructions to copy.');
    return;
  }
  await vscode.env.clipboard.writeText(listing);
  outputChannel.appendLine('');
  outputChannel.appendLine('=== Assembler listing copied ===');
  outputChannel.appendLine(listing);
  await vscode.window.showInformationMessage('Assembler listing copied to clipboard.');
}

async function copyMemoryDumpNative() {
  if (!await ensureCurrentFileAssembled()) return;
  const state = visibleSimState();
  const defaultAddress = state?.memory[0]?.address ?? `0x${BITMAP_START_ADDRESS.toString(16).toUpperCase()}`;
  const addressText = await vscode.window.showInputBox({
    title: 'Copy Memory Dump',
    prompt: 'Start address.',
    value: defaultAddress,
    validateInput: value => parseIntegerInput(value) === null ? 'Enter a decimal, hexadecimal, or binary address.' : null,
  });
  if (addressText === undefined) return;

  const wordsText = await vscode.window.showInputBox({
    title: 'Copy Memory Dump',
    prompt: 'Number of words to copy.',
    value: '128',
    validateInput: value => {
      const parsed = parseIntegerInput(value);
      return parsed !== null && parsed > 0n && parsed <= 4096n ? null : 'Enter a word count from 1 to 4096.';
    },
  });
  if (wordsText === undefined) return;

  const startAddress = Number(parseIntegerInput(addressText)! & 0xffffffffn);
  const wordCount = Number(parseIntegerInput(wordsText)!);
  const dump = nativeSimulator.memoryDump(startAddress, wordCount);
  await vscode.env.clipboard.writeText(dump);
  outputChannel.appendLine('');
  outputChannel.appendLine(`=== Memory dump copied from ${formatWordValue(startAddress)} (${wordCount} words) ===`);
  outputChannel.appendLine(dump);
  await vscode.window.showInformationMessage('Memory dump copied to clipboard.');
}

async function loadDocumentNative(document: vscode.TextDocument, action: RunAction): Promise<boolean> {
  if (!isAssemblyDocument(document)) {
    await vscode.window.showWarningMessage('Open a MIPS, RISC-V, or x86 assembly file first.');
    return false;
  }

  diagnostics.delete(document.uri);

  const architecture = getDocumentArchitecture(document);
  const result = action === 'run' && nativeSimulator.isCurrentDocument(document, architecture)
    ? (nativeSimulator.restartCurrentAssembly({ publish: false }) ? { ok: true as const } : await nativeSimulator.assemble(document, architecture, { publish: false }))
    : await nativeSimulator.assemble(document, architecture, { publish: action !== 'run' });
  if (!result.ok) {
    diagnostics.set(document.uri, result.errors.map((error: any) => {
      const line = Math.max(0, Number(error.lineNumber ?? 1) - 1);
      const column = Math.max(0, Number(error.columnNumber ?? 1) - 1);
      return new vscode.Diagnostic(
        new vscode.Range(line, column, line, column + 1),
        String(error.message ?? result.report ?? 'Assembly error'),
        vscode.DiagnosticSeverity.Error,
      );
    }));
    await vscode.window.showErrorMessage(result.report?.trim() || 'WIMPS assembly failed.');
    return false;
  }

  if (action === 'run') {
    outputChannel.clear();
    lastOutputText = '';
    await nativeSimulator.runUntilBreak(new Set());
    await revealWimpsTools();
    outputChannel.show(true);
  } else {
    await revealWimpsTools();
  }

  return true;
}

function isAssemblyDocument(document: vscode.TextDocument | undefined): document is vscode.TextDocument {
  if (!document || document.isUntitled) return false;
  if (document.languageId === 'mips' || document.languageId === 'riscv' || document.languageId === 'x86') return true;
  const fileName = document.fileName.toLowerCase();
  return [...ASM_EXTENSIONS].some(extension => fileName.endsWith(extension));
}

function getDocumentArchitecture(document: vscode.TextDocument): Architecture {
  if (document.languageId === 'riscv') return 'riscv';
  if (document.languageId === 'mips') return 'mips';
  if (document.languageId === 'x86') return 'x86';
  const fileName = document.fileName.toLowerCase();
  if ([...X86_EXTENSIONS].some(extension => fileName.endsWith(extension))) return 'x86';
  if ([...RISCV_EXTENSIONS].some(extension => fileName.endsWith(extension))) return 'riscv';
  return 'mips';
}

function getActiveAssemblyDocument(): vscode.TextDocument | undefined {
  const activeDocument = vscode.window.activeTextEditor?.document;
  if (isAssemblyDocument(activeDocument)) return activeDocument;
  return vscode.window.visibleTextEditors.find(editor => isAssemblyDocument(editor.document))?.document;
}

function scheduleActiveAssemblyContextRefresh() {
  for (const timer of activeAssemblyRefreshTimers) clearTimeout(timer);
  activeAssemblyRefreshTimers = [];
  void updateActiveAssemblyContext();
  activeAssemblyRefreshTimers.push(
    setTimeout(() => void updateActiveAssemblyContext(), 50),
    setTimeout(() => void updateActiveAssemblyContext(), 250),
    setTimeout(() => void updateActiveAssemblyContext(), 1000),
  );
}

function baseName(document: vscode.TextDocument): string {
  return document.fileName.split(/[\\/]/).pop() ?? ARCHITECTURES[getDocumentArchitecture(document)].defaultFileName;
}

async function updateActiveAssemblyContext() {
  const document = getActiveAssemblyDocument();
  const activeDocument = vscode.window.activeTextEditor?.document;
  const activeEditorIsAssembly = isAssemblyDocument(activeDocument);
  hasActiveAssemblyFile = Boolean(document);
  activeAssemblyFileName = document ? baseName(document) : '';
  await vscode.commands.executeCommand('setContext', 'wimps.activeEditorIsAssembly', activeEditorIsAssembly);
  await vscode.commands.executeCommand('setContext', 'wimps.hasAssemblyFile', hasActiveAssemblyFile);
  updateArchitectureStatusBar(activeEditorIsAssembly ? activeDocument : undefined);
  for (const view of stateViews) view.refresh();
}

function updateArchitectureStatusBar(document: vscode.TextDocument | undefined) {
  if (!architectureStatusBarItem) return;
  if (!document) {
    architectureStatusBarItem.hide();
    return;
  }

  const architecture = getDocumentArchitecture(document);
  architectureStatusBarItem.text = `$(circuit-board) ${ARCHITECTURES[architecture].label}`;
  architectureStatusBarItem.tooltip = 'Select assembly architecture';
  architectureStatusBarItem.command = 'wimps.selectArchitecture';
  architectureStatusBarItem.show();
}

async function selectAssemblyArchitecture() {
  const document = getActiveAssemblyDocument();
  if (!document) {
    await vscode.window.showWarningMessage('Open a MIPS, RISC-V, or x86 assembly file first.');
    return;
  }

  const current = getDocumentArchitecture(document);
  const choice = await vscode.window.showQuickPick([
    { label: 'MIPS', description: current === 'mips' ? 'Current' : 'Use @specy/mips', architecture: 'mips' as const },
    { label: 'RISC-V', description: current === 'riscv' ? 'Current' : 'Use @specy/risc-v', architecture: 'riscv' as const },
    { label: 'x86', description: current === 'x86' ? 'Current' : 'Use @specy/x86', architecture: 'x86' as const },
  ], {
    title: 'Assembly Architecture',
    placeHolder: 'Choose the simulator and language mode for this file.',
  });

  if (!choice) return;
  if (document.languageId !== choice.architecture) {
    await vscode.languages.setTextDocumentLanguage(document, choice.architecture);
  }
  scheduleActiveAssemblyContextRefresh();
}

async function revealSourceLine(line: number) {
  const document = getActiveAssemblyDocument();
  if (!document || !Number.isFinite(line)) return;
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const position = new vscode.Position(Math.max(0, Math.floor(line) - 1), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function visibleSimState(): SimStateMessage | undefined {
  const document = getActiveAssemblyDocument();
  if (!document || nativeSimulator.currentUri?.toString() !== document.uri.toString()) return undefined;
  return latestSimState;
}

class AssemblyCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(document: vscode.TextDocument): Promise<vscode.CompletionItem[]> {
    if (!isAssemblyLikeDocument(document)) return [];
    const architecture = getDocumentArchitecture(document);
    const items: vscode.CompletionItem[] = [];

    for (const instruction of (await getInstructionDocs(architecture)).values()) {
      const item = new vscode.CompletionItem(instruction.name, vscode.CompletionItemKind.Function);
      item.detail = `${ARCHITECTURES[architecture].label} instruction`;
      item.documentation = instructionMarkdown(instruction);
      if (instruction.example) item.insertText = instruction.name;
      items.push(item);
    }

    for (const register of registerCompletionNames(architecture)) {
      const item = new vscode.CompletionItem(register, vscode.CompletionItemKind.Variable);
      item.detail = `${ARCHITECTURES[architecture].label} register`;
      item.documentation = registerMarkdown(register, architecture);
      items.push(item);
    }

    for (const directive of DIRECTIVES) {
      const item = new vscode.CompletionItem(directive, vscode.CompletionItemKind.Keyword);
      item.detail = 'Assembler directive';
      items.push(item);
    }

    for (const label of labelsInDocument(document)) {
      const item = new vscode.CompletionItem(label.label, vscode.CompletionItemKind.Reference);
      item.detail = `Label on line ${label.line}`;
      items.push(item);
    }

    return items;
  }
}

class AssemblyHoverProvider implements vscode.HoverProvider {
  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    if (!isAssemblyLikeDocument(document)) return undefined;

    const token = currentInstructionToken(document, position);
    if (!token) return undefined;
    const architecture = getDocumentArchitecture(document);
    const normalized = token.toLowerCase();

    const instruction = (await getInstructionDocs(architecture)).get(normalized);
    if (instruction) {
      return new vscode.Hover(instructionMarkdown(instruction));
    }

    const registerNames = new Set(registerCompletionNames(architecture).map(name => name.toLowerCase()));
    if (registerNames.has(normalized)) {
      return new vscode.Hover(registerMarkdown(token, architecture));
    }

    if (token.startsWith('.')) {
      const markdown = new vscode.MarkdownString();
      markdown.appendCodeblock(token, 'asm');
      markdown.appendMarkdown('Assembler directive');
      return new vscode.Hover(markdown);
    }

    const label = labelsInDocument(document).find(candidate => candidate.label === token);
    if (label) {
      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(`Label defined on line ${label.line}.`);
      return new vscode.Hover(markdown);
    }

    return undefined;
  }
}

class AssemblyDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Definition> {
    if (!isAssemblyLikeDocument(document)) return undefined;
    const token = currentInstructionToken(document, position);
    if (!token) return undefined;

    const label = labelsInDocument(document).find(candidate => candidate.label === token);
    if (!label) return undefined;

    const targetLine = Math.max(0, label.line - 1);
    const targetText = document.lineAt(targetLine).text;
    const column = Math.max(0, targetText.indexOf(label.label));
    return new vscode.Location(document.uri, new vscode.Position(targetLine, column));
  }
}

class AssemblyDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    if (!isAssemblyLikeDocument(document)) return [];
    return labelsInDocument(document).map(label => {
      const line = Math.max(0, label.line - 1);
      const text = document.lineAt(line).text;
      const start = Math.max(0, text.indexOf(label.label));
      const range = new vscode.Range(line, start, line, start + label.label.length);
      return new vscode.DocumentSymbol(label.label, 'Assembly label', vscode.SymbolKind.Function, range, range);
    });
  }
}

function isAssemblyLikeDocument(document: vscode.TextDocument): boolean {
  if (document.languageId === 'mips' || document.languageId === 'riscv' || document.languageId === 'x86') return true;
  const fileName = document.fileName.toLowerCase();
  return [...ASM_EXTENSIONS].some(extension => fileName.endsWith(extension));
}

function instructionMarkdown(instruction: InstructionDoc): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.appendCodeblock(instruction.example || instruction.name, 'asm');
  if (instruction.description) markdown.appendMarkdown(instruction.description);
  return markdown;
}

function registerMarkdown(register: string, architecture: Architecture): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.appendCodeblock(register, 'asm');
  if (architecture === 'riscv') {
    markdown.appendMarkdown(`RISC-V general-purpose register ${register}.`);
  } else if (architecture === 'x86') {
    markdown.appendMarkdown(`x86 general-purpose register ${register}.`);
  } else {
    markdown.appendMarkdown(`MIPS general-purpose register ${register}.`);
  }
  return markdown;
}

async function documentFromProgram(program: string | undefined): Promise<vscode.TextDocument | undefined> {
  if (program) {
    const uri = parseDebugProgramUri(program);
    const document = await vscode.workspace.openTextDocument(uri);
    return isAssemblyDocument(document) ? document : undefined;
  }

  return getActiveAssemblyDocument();
}

function debugSourcePath(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? uri.fsPath : uri.toString();
}

function parseDebugProgramUri(program: string): vscode.Uri {
  if (/^[a-z][a-z0-9+.-]*:/i.test(program)) return vscode.Uri.parse(program);
  return vscode.Uri.file(program);
}

type DapMessage = {
  seq: number;
  type: 'request' | 'response' | 'event';
  command?: string;
  event?: string;
  arguments?: any;
  request_seq?: number;
  success?: boolean;
  body?: any;
};

class WimpsDebugAdapter implements vscode.DebugAdapter {
  private readonly emitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  private seq = 1;
  private breakpointLines = new Set<number>();
  private debugOutput = '';

  readonly onDidSendMessage = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    debugAdapters.add(this);
  }

  dispose() {
    debugAdapters.delete(this);
    this.emitter.dispose();
  }

  handleMessage(message: vscode.DebugProtocolMessage) {
    const request = message as DapMessage;
    if (request.type !== 'request') return;

    switch (request.command) {
      case 'initialize':
        this.sendResponse(request, {
          supportsConfigurationDoneRequest: true,
          supportsTerminateRequest: true,
          supportsStepBack: true,
          supportsStepInTargetsRequest: false,
          supportsEvaluateForHovers: false,
        });
        this.sendEvent('initialized');
        break;
      case 'launch':
        void this.launch(request);
        break;
      case 'setBreakpoints':
        this.breakpointLines = new Set((request.arguments?.breakpoints ?? []).map((breakpoint: any) => Number(breakpoint.line)));
        this.sendResponse(request, {
          breakpoints: (request.arguments?.breakpoints ?? []).map((breakpoint: any) => ({
            verified: true,
            line: breakpoint.line,
          })),
        });
        break;
      case 'configurationDone':
        this.sendResponse(request);
        break;
      case 'threads':
        this.sendResponse(request, { threads: [{ id: 1, name: 'Assembly simulator' }] });
        break;
      case 'stackTrace':
        this.sendResponse(request, {
          stackFrames: [nativeSimulator.stackFrame()],
          totalFrames: 1,
        });
        break;
      case 'scopes':
        this.sendResponse(request, {
          scopes: [
            { name: 'Registers', variablesReference: 1, expensive: false },
            { name: 'Console', variablesReference: 2, expensive: false },
          ],
        });
        break;
      case 'variables':
        this.sendResponse(request, { variables: this.variablesFor(Number(request.arguments?.variablesReference ?? 0)) });
        break;
      case 'continue':
        this.continueNative();
        this.sendResponse(request, { allThreadsContinued: true });
        break;
      case 'next':
      case 'stepIn':
        this.stepNative();
        this.sendResponse(request);
        break;
      case 'stepBack':
        this.stepBackNative();
        this.sendResponse(request);
        break;
      case 'pause':
        this.sendResponse(request);
        this.sendEvent('stopped', { reason: 'pause', threadId: 1 });
        break;
      case 'disconnect':
      case 'terminate':
        nativeSimulator.reset();
        this.sendResponse(request);
        this.sendEvent('terminated');
        break;
      default:
        this.sendResponse(request);
        break;
    }
  }

  onSimState(state: SimStateMessage) {
    if (state.status === 'assembled' || state.status === 'error' || state.status === 'idle') {
      this.debugOutput = '';
    }

    if (!state.output) return;

    if (state.output.startsWith(this.debugOutput)) {
      const next = state.output.slice(this.debugOutput.length);
      if (next) this.sendEvent('output', { category: 'stdout', output: next });
    } else {
      this.sendEvent('output', { category: 'stdout', output: state.output });
    }
    this.debugOutput = state.output;
  }

  private async launch(request: DapMessage) {
    const program = request.arguments?.program as string | undefined;
    const document = await documentFromProgram(program);
    if (!document) {
      this.sendResponse(request);
      this.sendEvent('terminated');
      return;
    }
    await vscode.window.showTextDocument(document, { preview: false });
    const ok = await loadDocumentNative(document, 'assemble');
    this.sendResponse(request);
    if (ok) this.sendEvent('stopped', { reason: 'entry', threadId: 1 });
    else this.sendEvent('terminated');
  }

  private async continueNative() {
    const result = await nativeSimulator.runUntilBreak(this.breakpointLines);
    if (result === 'terminated') this.sendEvent('terminated');
    else this.sendEvent('stopped', { reason: result === 'breakpoint' ? 'breakpoint' : 'step', threadId: 1 });
  }

  private async stepNative() {
    const result = await nativeSimulator.step();
    if (result === 'terminated') this.sendEvent('terminated');
    else this.sendEvent('stopped', { reason: result === 'waiting' ? 'pause' : 'step', threadId: 1 });
  }

  private stepBackNative() {
    const result = nativeSimulator.stepBack();
    this.sendEvent('stopped', { reason: result === 'no-history' ? 'pause' : 'step', threadId: 1 });
  }

  private variablesFor(reference: number) {
    if (reference === 1) {
      return (latestSimState?.registers ?? []).map(register => ({
        name: register.name,
        value: register.hexValue,
        type: 'register',
        variablesReference: 0,
      }));
    }

    if (reference === 2) {
      return [{
        name: 'output',
        value: latestSimState?.output?.trim() || 'No program output.',
        type: 'string',
        variablesReference: 0,
      }];
    }

    return [];
  }

  private sendResponse(request: DapMessage, body?: any) {
    this.emitter.fire({
      seq: this.seq++,
      type: 'response',
      request_seq: request.seq,
      command: request.command,
      success: true,
      body,
    } as vscode.DebugProtocolMessage);
  }

  private sendEvent(event: string, body?: any) {
    this.emitter.fire({
      seq: this.seq++,
      type: 'event',
      event,
      body,
    } as vscode.DebugProtocolMessage);
  }
}

type StateTreeKind = 'registers' | 'memory' | 'program' | 'analysis';

class WimpsTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    options: {
      description?: string;
      detail?: string;
      icon?: vscode.ThemeIcon;
      command?: vscode.Command;
      contextValue?: string;
      registerName?: string;
      memoryAddress?: string;
      children?: WimpsTreeItem[];
    } = {},
  ) {
    super(label, options.children?.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    this.description = options.description;
    this.tooltip = options.detail ? new vscode.MarkdownString(options.detail) : undefined;
    this.iconPath = options.icon;
    this.command = options.command;
    this.contextValue = options.contextValue;
    this.registerName = options.registerName;
    this.memoryAddress = options.memoryAddress;
    this.children = options.children;
  }

  readonly registerName: string | undefined;
  readonly memoryAddress: string | undefined;
  readonly children: WimpsTreeItem[] | undefined;
}

class WimpsStateTreeProvider implements vscode.TreeDataProvider<WimpsTreeItem>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<WimpsTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly kind: StateTreeKind) {
    stateViews.add(this);
  }

  dispose() {
    stateViews.delete(this);
    this.emitter.dispose();
  }

  refresh() {
    this.emitter.fire();
  }

  getTreeItem(element: WimpsTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: WimpsTreeItem): vscode.ProviderResult<WimpsTreeItem[]> {
    if (element?.children) return element.children;

    if (!hasActiveAssemblyFile) {
      return [];
    }

    const state = visibleSimState();
    if (!state) {
      return [new WimpsTreeItem('Assemble the active file', {
        description: activeAssemblyFileName,
        icon: new vscode.ThemeIcon('debug-start'),
      })];
    }

    return this.kind === 'registers' ? this.registerRows(state)
      : this.kind === 'memory' ? this.memoryRows(state)
      : this.kind === 'program' ? this.programRows(state)
      : this.analysisRows(state);
  }

  private registerRows(state: SimStateMessage): WimpsTreeItem[] {
    return [
      new WimpsTreeItem(`${state.architectureLabel} ${state.status}`, {
        description: `PC ${state.pc}`,
        icon: new vscode.ThemeIcon('circuit-board'),
        detail: `${state.fileName}\n${state.totalInstructions} executed instructions`,
      }),
      new WimpsTreeItem('General registers', {
        description: `${state.registers.length}`,
        icon: new vscode.ThemeIcon('list-tree'),
        children: state.registers.map(register => new WimpsTreeItem(register.name, {
          description: register.hexValue,
          detail: `Register ${register.number}\nHex: ${register.hexValue}\nDecimal: ${register.decimalValue ?? ''}`,
          icon: new vscode.ThemeIcon(register.name === 'zero' || register.name === '$zero' ? 'circle-slash' : 'symbol-variable'),
          contextValue: 'wimpsRegister',
          registerName: register.name,
        })),
      }),
      new WimpsTreeItem('Special registers', {
        description: `${state.specialRegisters.length}`,
        icon: new vscode.ThemeIcon('settings-gear'),
        children: state.specialRegisters.map(register => new WimpsTreeItem(register.name, {
          description: register.value,
          detail: register.detail,
          icon: new vscode.ThemeIcon('symbol-constant'),
        })),
      }),
    ];
  }

  private memoryRows(state: SimStateMessage): WimpsTreeItem[] {
    const rows = state.memory.length ? state.memory : [{ address: 'No readable memory', value: '' }];
    return rows.map(word => new WimpsTreeItem(word.address, {
      description: word.value,
      detail: word.value ? `${word.address}: ${word.value}` : undefined,
      icon: new vscode.ThemeIcon('symbol-numeric'),
      contextValue: word.value ? 'wimpsMemoryWord' : undefined,
      memoryAddress: word.value ? word.address : undefined,
    }));
  }

  private programRows(state: SimStateMessage): WimpsTreeItem[] {
    if (state.program.length === 0) {
      return [new WimpsTreeItem('No compiled program', {
        description: state.fileName,
        icon: new vscode.ThemeIcon('warning'),
      })];
    }

    const instructionRows = state.program.map(row => {
      const current = row.address === state.pc;
      return new WimpsTreeItem(formatInstructionDisplay(row.assembly), {
        description: `${row.address} ${row.machine}${current ? ' current' : ''}`,
        detail: `Source line ${row.sourceLine}: ${row.source}\n${row.machine}`,
        icon: new vscode.ThemeIcon(current ? 'debug-stackframe-active' : 'symbol-method'),
        command: {
          command: 'wimps.revealSourceLine',
          title: 'Reveal Source Line',
          arguments: [row.sourceLine],
        },
        contextValue: current ? 'wimpsCurrentProgramRow' : 'wimpsProgramRow',
      });
    });
    const symbolRows = state.symbols.map(symbol => new WimpsTreeItem(symbol.label, {
      description: `${symbol.segment} ${symbol.address}`,
      detail: `${symbol.label}\n${symbol.segment} segment\n${symbol.address}`,
      icon: new vscode.ThemeIcon(symbol.segment === 'text' ? 'symbol-method' : 'symbol-field'),
    }));

    return [
      new WimpsTreeItem('Instructions', {
        description: `${instructionRows.length}`,
        icon: new vscode.ThemeIcon('list-ordered'),
        children: instructionRows,
      }),
      new WimpsTreeItem('Symbols', {
        description: `${symbolRows.length}`,
        icon: new vscode.ThemeIcon('symbol-key'),
        children: symbolRows.length ? symbolRows : [new WimpsTreeItem('No labels found', { icon: new vscode.ThemeIcon('info') })],
      }),
    ];
  }

  private analysisRows(state: SimStateMessage): WimpsTreeItem[] {
    const stats = state.stats ?? emptyStats();
    const statRows = (Object.keys(stats) as InstrCategory[]).map(key => {
      const count = stats[key];
      const pct = state.totalInstructions ? ((count / state.totalInstructions) * 100).toFixed(1) : '0.0';
      return new WimpsTreeItem(key, {
        description: `${count} (${pct}%)`,
        icon: new vscode.ThemeIcon(categoryIcon(key)),
      });
    });
    const cacheRows = [
      new WimpsTreeItem('Configuration', {
        description: `${state.cache.config.cacheBytes} B, ${state.cache.config.blockBytes} B blocks, ${state.cache.config.associativity} way`,
        icon: new vscode.ThemeIcon('settings-gear'),
      }),
      new WimpsTreeItem('Hit rate', {
        description: `${(state.cache.hitRate * 100).toFixed(1)}%`,
        icon: new vscode.ThemeIcon('dashboard'),
      }),
      new WimpsTreeItem('Hits / misses', {
        description: `${state.cache.hits} / ${state.cache.misses}`,
        icon: new vscode.ThemeIcon('pulse'),
      }),
      ...state.cache.accesses.slice(-100).map(access => new WimpsTreeItem(access.hit ? 'hit' : 'miss', {
        description: `${formatWordValue(access.address)} ${access.op}${access.line ? ` line ${access.line}` : ''}`,
        icon: new vscode.ThemeIcon(access.hit ? 'check' : 'close'),
      })),
    ];
    return [
      new WimpsTreeItem('Instructions executed', {
        description: String(state.totalInstructions ?? 0),
        icon: new vscode.ThemeIcon('pulse'),
        detail: `${state.architectureLabel} ${state.fileName}`,
      }),
      new WimpsTreeItem('Instruction mix', {
        description: `${state.totalInstructions ?? 0}`,
        icon: new vscode.ThemeIcon('graph'),
        children: statRows,
      }),
      new WimpsTreeItem('Cache analysis', {
        description: `${state.cache.hits} hits, ${state.cache.misses} misses`,
        icon: new vscode.ThemeIcon('database'),
        children: state.cache.accesses.length ? cacheRows : [
          new WimpsTreeItem('No accesses yet', {
            description: 'Run or step a program',
            icon: new vscode.ThemeIcon('info'),
          }),
        ],
      }),
    ];
  }
}

function categoryIcon(category: InstrCategory): string {
  return category === 'arithmetic' ? 'symbol-operator'
    : category === 'logic' ? 'circuit-board'
    : category === 'memory' ? 'database'
    : category === 'branch' ? 'git-branch'
    : category === 'jump' ? 'debug-step-over'
    : category === 'syscall' ? 'terminal'
    : 'symbol-misc';
}

class WimpsStateViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private readonly kind: 'registers' | 'memory' | 'bitmap' | 'program' | 'analysis') {
    stateViews.add(this);
  }

  dispose() {
    stateViews.delete(this);
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: this.kind === 'bitmap' };
    if (this.kind === 'bitmap') {
      view.webview.onDidReceiveMessage(message => {
        handleBitmapViewMessage(message);
      });
    }
    view.onDidDispose(() => {
      this.view = undefined;
    });
    this.refresh();
  }

  refresh() {
    if (!this.view) return;
    if (!hasActiveAssemblyFile) {
      this.view.webview.html = renderInactiveView(this.kind);
      return;
    }

    const state = visibleSimState();
    this.view.webview.html =
      this.kind === 'registers' ? renderRegistersView(state)
      : this.kind === 'memory' ? renderMemoryView(state)
      : this.kind === 'bitmap' ? renderBitmapView(state)
      : this.kind === 'program' ? renderProgramView(state)
      : renderAnalysisView(state);
  }
}

function handleBitmapViewMessage(message: any) {
  if (message?.type !== 'wimps.bitmapSettings') return;

  const nextAddress = parseBitmapAddress(String(message.address ?? ''));
  const nextWidth = clampBitmapNumber(Number(message.width), 1, 256, BITMAP_DEFAULT_WIDTH);
  const nextHeight = clampBitmapNumber(Number(message.height), 1, 256, BITMAP_DEFAULT_HEIGHT);
  const nextScale = [1, 2, 3, 4, 6, 8].includes(Number(message.scale)) ? Number(message.scale) : 4;

  bitmapDisplaySettings = {
    startAddress: nextAddress,
    width: nextWidth,
    height: nextHeight,
    scale: nextScale,
  };

  if (latestSimState) {
    latestSimState = {
      ...latestSimState,
      bitmap: nativeSimulator.readBitmapDisplay(nextAddress),
    };
  }

  for (const view of stateViews) view.refresh();
}

function parseBitmapAddress(value: string): number {
  const parsed = parseInt(value.trim().replace(/^0[xX]/, ''), 16);
  return Number.isFinite(parsed) ? parsed >>> 0 : BITMAP_START_ADDRESS;
}

function parseIntegerInput(value: string): bigint | null {
  const trimmed = value.trim().replace(/_/g, '');
  if (!trimmed) return null;
  try {
    if (/^[-+]?0x[\da-f]+$/i.test(trimmed)) {
      const negative = trimmed.startsWith('-');
      const digits = trimmed.replace(/^[-+]?0x/i, '');
      const parsed = BigInt(`0x${digits}`);
      return negative ? -parsed : parsed;
    }
    if (/^[-+]?0b[01]+$/i.test(trimmed)) {
      const negative = trimmed.startsWith('-');
      const digits = trimmed.replace(/^[-+]?0b/i, '');
      const parsed = BigInt(`0b${digits}`);
      return negative ? -parsed : parsed;
    }
    if (/^[-+]?\d+$/.test(trimmed)) return BigInt(trimmed);
  } catch {
    return null;
  }
  return null;
}

function formatHex32(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
}

function clampBitmapNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function viewTitle(kind: WimpsStateViewProvider['kind']): string {
  return kind === 'registers' ? 'Registers'
    : kind === 'memory' ? 'Memory'
    : kind === 'bitmap' ? 'Bitmap Display'
    : kind === 'program' ? 'Program'
    : 'Analysis';
}

function renderInactiveView(kind: WimpsStateViewProvider['kind']): string {
  return renderViewShell(viewTitle(kind), renderEmptyCard(
    'No assembly file active',
    'Open a MIPS, RISC-V, or x86 assembly file to show simulator state here.',
    ['.asm', '.s', '.riscv', '.x86'],
  ));
}

function renderIdleView(title: string, detail: string, tags: string[] = []): string {
  return renderViewShell(title, renderEmptyCard(
    activeAssemblyFileName || 'Assembly file ready',
    detail,
    tags,
  ));
}

function renderEmptyCard(title: string, detail: string, tags: string[]): string {
  const renderedTags = tags.map(tag => `<code>${escapeHtml(tag)}</code>`).join('');
  return `
    <div class="empty-card">
      <div class="empty-mark">W</div>
      <div class="empty-title">${escapeHtml(title)}</div>
      <p class="empty-copy">${escapeHtml(detail)}</p>
      ${renderedTags ? `<div class="empty-tags">${renderedTags}</div>` : ''}
    </div>
  `;
}

function renderRegistersView(state: SimStateMessage | undefined): string {
  if (!state) return renderIdleView('Register State', 'Assemble the active file to populate register values.', ['$zero', '$v0', '$a0']);

  const rows = state.registers.map(register => `
    <tr>
      <td>${escapeHtml(register.name)}</td>
      <td>${register.number}</td>
      <td><code>${escapeHtml(register.hexValue)}</code></td>
    </tr>
  `).join('');

  return renderViewShell('Register State', `
    <div class="meta">${escapeHtml(state.architectureLabel)} · ${escapeHtml(state.fileName)} · ${escapeHtml(state.status)}</div>
    <div class="summary-grid">
      <div class="summary-card"><span>PC</span><code>${escapeHtml(state.pc)}</code></div>
      <div class="summary-card"><span>Registers</span><strong>${state.registers.length}</strong></div>
      <div class="summary-card"><span>Status</span><strong>${escapeHtml(state.status)}</strong></div>
    </div>
    <section class="native-section content-section">
      <div class="section-title">General Registers</div>
      <table class="data-table register-table">
        <thead><tr><th>Name</th><th>#</th><th>Value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `);
}

function renderConsoleView(state: SimStateMessage | undefined): string {
  if (!state) return renderIdleView('Console', 'Run the active file to capture stdout.', ['syscall']);

  const output = state.output.trim() ? escapeHtml(state.output) : 'No program output.';
  return renderViewShell('Console', `
    <div class="meta">${escapeHtml(state.architectureLabel)} · ${escapeHtml(state.fileName)} · ${escapeHtml(state.status)}</div>
    <pre>${output}</pre>
  `);
}

function renderMemoryView(state: SimStateMessage | undefined): string {
  if (!state) return renderIdleView('Data Memory', 'Assemble or run the active file to inspect data memory.', ['0x10010000']);
  const rows = (state.memory ?? []).map(word => `
    <tr>
      <td><code>${escapeHtml(word.address)}</code></td>
      <td><code>${escapeHtml(word.value)}</code></td>
    </tr>
  `).join('');
  return renderViewShell('Data Memory', `
    <div class="meta">${escapeHtml(state.architectureLabel)} · ${escapeHtml(state.fileName)} · data segment</div>
    <section class="native-section content-section">
      <div class="section-title">Memory Words</div>
      <table class="data-table memory-table">
        <thead><tr><th>Address</th><th>Word</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="2">No readable memory.</td></tr>'}</tbody>
      </table>
    </section>
  `);
}

type ProgramFormat = 'hex' | 'binary';

type DecodedField = {
  key: string;
  value: number;
  width: number;
  alias?: string;
};

type DecodedInstruction = {
  kind: string;
  fields: DecodedField[];
};

function registerAlias(index: number): string {
  return MIPS_REGISTER_NAMES[index] ?? `$${index}`;
}

function normalizeAssemblyAliases(assembly: string): string {
  return assembly.replace(/(^|[^\w$])\$(\d+)\b/g, (_match, prefix: string, raw: string) => `${prefix}${registerAlias(Number(raw))}`);
}

function normalizeAssemblySpacing(assembly: string): string {
  return normalizeAssemblyAliases(assembly)
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

const NUMBER_TOKEN_RE = /(?<![\w$])(-?0x[\da-f]+|-?\d+)(?![\w$])/gi;

function formatDecimalToken(token: string): string {
  if (/^-?\d+$/.test(token)) return token;
  const negative = token.startsWith('-');
  const digits = token.replace(/^-?0x/i, '');
  const value = parseInt(digits, 16);
  if (Number.isNaN(value)) return token;
  if (negative) return `-${value}`;
  if (digits.length === 8 && value > 0x7fffffff) return String(value - 0x100000000);
  if (digits.length === 4 && value > 0x7fff) return String(value - 0x10000);
  return String(value);
}

function formatInstructionDisplay(assembly: string): string {
  return normalizeAssemblySpacing(assembly.replace(NUMBER_TOKEN_RE, match => formatDecimalToken(match)));
}

function formatBinary(value: number, width: number): string {
  return (value >>> 0).toString(2).padStart(width, '0');
}

function groupBinary(bits: string, size = 4): string {
  const groups: string[] = [];
  for (let index = bits.length; index > 0; index -= size) {
    groups.unshift(bits.slice(Math.max(0, index - size), index));
  }
  return groups.join(' ');
}

function formatBinaryWrapped(value: number, width: number, lineWidth = 16): string {
  const bits = formatBinary(value, width);
  if (width <= lineWidth) return groupBinary(bits);
  const lines: string[] = [];
  for (let index = 0; index < bits.length; index += lineWidth) {
    lines.push(groupBinary(bits.slice(index, index + lineWidth)));
  }
  return lines.join('\n');
}

function formatFieldValue(field: DecodedField, format: ProgramFormat): string {
  if (format === 'binary') return formatBinaryWrapped(field.value, field.width, field.width > 16 ? 16 : field.width);
  return `0x${field.value.toString(16).padStart(Math.ceil(field.width / 4), '0')}`;
}

function fieldDisplayLabel(field: DecodedField): string {
  return field.key === 'address' ? 'target' : field.key;
}

function decodeMipsProgramRow(row: SimProgramRow): DecodedInstruction {
  const word = row.binary >>> 0;
  const opcode = (word >>> 26) & 0x3f;

  if (opcode === 0) {
    const rs = (word >>> 21) & 0x1f;
    const rt = (word >>> 16) & 0x1f;
    const rd = (word >>> 11) & 0x1f;
    return {
      kind: 'r',
      fields: [
        { key: 'opcode', value: opcode, width: 6 },
        { key: 'rs', value: rs, width: 5, alias: registerAlias(rs) },
        { key: 'rt', value: rt, width: 5, alias: registerAlias(rt) },
        { key: 'rd', value: rd, width: 5, alias: registerAlias(rd) },
        { key: 'shamt', value: (word >>> 6) & 0x1f, width: 5 },
        { key: 'funct', value: word & 0x3f, width: 6 },
      ],
    };
  }

  if (opcode === 2 || opcode === 3) {
    return {
      kind: 'j',
      fields: [
        { key: 'opcode', value: opcode, width: 6 },
        { key: 'address', value: word & 0x03ffffff, width: 26 },
      ],
    };
  }

  const rs = (word >>> 21) & 0x1f;
  const rt = (word >>> 16) & 0x1f;
  return {
    kind: 'i',
    fields: [
      { key: 'opcode', value: opcode, width: 6 },
      { key: 'rs', value: rs, width: 5, alias: registerAlias(rs) },
      { key: 'rt', value: rt, width: 5, alias: registerAlias(rt) },
      { key: 'imm', value: word & 0xffff, width: 16 },
    ],
  };
}

function riscvRegisterAlias(index: number): string {
  return RISCV_REGISTER_NAMES[index] ?? `x${index}`;
}

function decodeRiscvProgramRow(row: SimProgramRow): DecodedInstruction {
  const word = row.binary >>> 0;
  const opcode = word & 0x7f;
  const rd = (word >>> 7) & 0x1f;
  const funct3 = (word >>> 12) & 0x7;
  const rs1 = (word >>> 15) & 0x1f;
  const rs2 = (word >>> 20) & 0x1f;
  const funct7 = (word >>> 25) & 0x7f;

  if (opcode === 0x33 || opcode === 0x3b || opcode === 0x2f || opcode === 0x53) {
    return {
      kind: 'r',
      fields: [
        { key: 'funct7', value: funct7, width: 7 },
        { key: 'rs2', value: rs2, width: 5, alias: riscvRegisterAlias(rs2) },
        { key: 'rs1', value: rs1, width: 5, alias: riscvRegisterAlias(rs1) },
        { key: 'funct3', value: funct3, width: 3 },
        { key: 'rd', value: rd, width: 5, alias: riscvRegisterAlias(rd) },
        { key: 'opcode', value: opcode, width: 7 },
      ],
    };
  }

  if (opcode === 0x63) {
    const imm = (((word >>> 31) & 0x1) << 12) |
      (((word >>> 7) & 0x1) << 11) |
      (((word >>> 25) & 0x3f) << 5) |
      (((word >>> 8) & 0xf) << 1);
    return {
      kind: 'b',
      fields: [
        { key: 'imm', value: imm, width: 13 },
        { key: 'rs2', value: rs2, width: 5, alias: riscvRegisterAlias(rs2) },
        { key: 'rs1', value: rs1, width: 5, alias: riscvRegisterAlias(rs1) },
        { key: 'funct3', value: funct3, width: 3 },
        { key: 'opcode', value: opcode, width: 7 },
      ],
    };
  }

  if (opcode === 0x23) {
    const imm = ((word >>> 25) << 5) | rd;
    return {
      kind: 's',
      fields: [
        { key: 'imm', value: imm, width: 12 },
        { key: 'rs2', value: rs2, width: 5, alias: riscvRegisterAlias(rs2) },
        { key: 'rs1', value: rs1, width: 5, alias: riscvRegisterAlias(rs1) },
        { key: 'funct3', value: funct3, width: 3 },
        { key: 'opcode', value: opcode, width: 7 },
      ],
    };
  }

  if (opcode === 0x37 || opcode === 0x17) {
    return {
      kind: 'u',
      fields: [
        { key: 'imm', value: word >>> 12, width: 20 },
        { key: 'rd', value: rd, width: 5, alias: riscvRegisterAlias(rd) },
        { key: 'opcode', value: opcode, width: 7 },
      ],
    };
  }

  if (opcode === 0x6f) {
    const imm = (((word >>> 31) & 0x1) << 20) |
      (((word >>> 12) & 0xff) << 12) |
      (((word >>> 20) & 0x1) << 11) |
      (((word >>> 21) & 0x3ff) << 1);
    return {
      kind: 'j',
      fields: [
        { key: 'imm', value: imm, width: 21 },
        { key: 'rd', value: rd, width: 5, alias: riscvRegisterAlias(rd) },
        { key: 'opcode', value: opcode, width: 7 },
      ],
    };
  }

  return {
    kind: 'i',
    fields: [
      { key: 'imm', value: word >>> 20, width: 12 },
      { key: 'rs1', value: rs1, width: 5, alias: riscvRegisterAlias(rs1) },
      { key: 'funct3', value: funct3, width: 3 },
      { key: 'rd', value: rd, width: 5, alias: riscvRegisterAlias(rd) },
      { key: 'opcode', value: opcode, width: 7 },
    ],
  };
}

function decodeProgramRow(row: SimProgramRow, architecture: Architecture): DecodedInstruction {
  return architecture === 'riscv' ? decodeRiscvProgramRow(row) : decodeMipsProgramRow(row);
}

function renderBitmapView(state: SimStateMessage | undefined): string {
  if (!state) return renderIdleView('Bitmap Display', 'Run a bitmap program to inspect pixels from memory.', ['0x10010000', '0x00RRGGBB']);
  const bitmap = state.bitmap ?? { startAddress: '0x10010000', colors: [] };
  const colorsJson = JSON.stringify(bitmap.colors).replace(/</g, '\\u003c');
  const settings = bitmapDisplaySettings;
  const addressText = `0x${settings.startAddress.toString(16).toUpperCase()}`;
  const scaleOptions = [1, 2, 3, 4, 6, 8].map(scale => (
    `<option value="${scale}"${settings.scale === scale ? ' selected' : ''}>${scale}×</option>`
  )).join('');
  const presetButtons = [
    { label: '64 × 64', width: 64, height: 64 },
    { label: '128 × 128', width: 128, height: 128 },
    { label: '256 × 64', width: 256, height: 64 },
    { label: '64 × 256', width: 64, height: 256 },
  ].map(preset => {
    const active = settings.width === preset.width && settings.height === preset.height;
    return `<button type="button" class="bitmap-preset${active ? ' active' : ''}" data-width="${preset.width}" data-height="${preset.height}">${preset.label}</button>`;
  }).join('');
  return renderViewShell('Bitmap Display', `
    <div class="meta">${escapeHtml(state.architectureLabel)} · ${escapeHtml(state.fileName)} · ${escapeHtml(state.status)} · ${escapeHtml(addressText)}</div>
    <div class="bitmap-panel" data-default-width="${BITMAP_DEFAULT_WIDTH}" data-default-height="${BITMAP_DEFAULT_HEIGHT}">
      <section class="native-section bitmap-settings">
        <div class="section-title">Display Settings</div>
        <div class="bitmap-settings-grid">
          <label class="bitmap-field bitmap-base-field">
            <span>Base Address</span>
            <input id="bitmap-base" value="${escapeHtml(addressText)}" spellcheck="false" aria-label="Base address">
          </label>

          <label class="bitmap-field bitmap-scale-field">
            <span>Scale</span>
            <select id="bitmap-scale" aria-label="Display scale">
              ${scaleOptions}
            </select>
          </label>
        </div>

        <div class="bitmap-preset-group">
          <div class="bitmap-group-label">Canvas Size</div>
          <div class="bitmap-presets" aria-label="Bitmap size presets">
            ${presetButtons}
          </div>
        </div>

        <div class="bitmap-actions">
          <button id="bitmap-reset" type="button" class="bitmap-reset" hidden>Reset settings</button>
        </div>
      </section>

      <div class="summary-grid bitmap-summary">
        <div class="summary-card"><span>Canvas</span><code id="bitmap-size">${settings.width} × ${settings.height}</code></div>
        <div class="summary-card"><span>Rendered</span><code id="bitmap-display">${settings.width * settings.scale} × ${settings.height * settings.scale}</code></div>
        <div class="summary-card"><span>Address</span><code id="bitmap-address">${escapeHtml(addressText)}</code></div>
      </div>

      <div class="bitmap-viewport native-section">
        <div class="bitmap-frame">
          <canvas id="bitmap" width="${settings.width * settings.scale}" height="${settings.height * settings.scale}" aria-label="Bitmap display"></canvas>
        </div>
      </div>

      <div class="bitmap-hint">
        Write 32-bit color words from <code id="bitmap-hint-address">${escapeHtml(addressText)}</code> using <code>0x00RRGGBB</code>.
      </div>
    </div>
    <script>
      (function () {
        var vscode = acquireVsCodeApi();
        var colors = ${colorsJson};
        var defaults = { address: '0x10010000', width: 64, height: 64, scale: 4 };
        var settings = { address: ${JSON.stringify(addressText)}, width: ${settings.width}, height: ${settings.height}, scale: ${settings.scale} };
        var canvas = document.getElementById('bitmap');
        var base = document.getElementById('bitmap-base');
        var scale = document.getElementById('bitmap-scale');
        var reset = document.getElementById('bitmap-reset');
        var sizeText = document.getElementById('bitmap-size');
        var displayText = document.getElementById('bitmap-display');
        var addressText = document.getElementById('bitmap-address');
        var hintAddress = document.getElementById('bitmap-hint-address');
        var ctx = canvas.getContext('2d');

        function publish() {
          vscode.postMessage({
            type: 'wimps.bitmapSettings',
            address: settings.address,
            width: settings.width,
            height: settings.height,
            scale: settings.scale
          });
        }

        function draw() {
          var width = settings.width;
          var height = settings.height;
          var displayWidth = width * settings.scale;
          var displayHeight = height * settings.scale;
          var tmp = document.createElement('canvas');
          tmp.width = width;
          tmp.height = height;
          var tmpCtx = tmp.getContext('2d');
          var image = tmpCtx.createImageData(width, height);
          for (var i = 0; i < width * height; i++) {
            var hex = colors[i] || '#000000';
            image.data[i * 4] = parseInt(hex.slice(1, 3), 16) || 0;
            image.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16) || 0;
            image.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16) || 0;
            image.data[i * 4 + 3] = 255;
          }
          tmpCtx.putImageData(image, 0, 0);
          canvas.width = displayWidth;
          canvas.height = displayHeight;
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, displayWidth, displayHeight);
          ctx.drawImage(tmp, 0, 0, displayWidth, displayHeight);
          sizeText.textContent = width + ' × ' + height;
          displayText.textContent = displayWidth + ' × ' + displayHeight;
          addressText.textContent = settings.address;
          hintAddress.textContent = settings.address;
          reset.hidden = settings.address === defaults.address && width === defaults.width && height === defaults.height && settings.scale === defaults.scale;
        }

        Array.prototype.forEach.call(document.querySelectorAll('.bitmap-preset'), function (button) {
          button.addEventListener('click', function () {
            settings.width = Number(button.dataset.width) || 64;
            settings.height = Number(button.dataset.height) || 64;
            Array.prototype.forEach.call(document.querySelectorAll('.bitmap-preset'), function (next) {
              next.classList.toggle('active', next === button);
            });
            draw();
            publish();
          });
        });
        scale.addEventListener('change', function () {
          settings.scale = Number(scale.value) || 4;
          draw();
          publish();
        });
        base.addEventListener('input', function () {
          settings.address = base.value || defaults.address;
          addressText.textContent = settings.address;
          hintAddress.textContent = settings.address;
          reset.hidden = settings.address === defaults.address && settings.width === defaults.width && settings.height === defaults.height && settings.scale === defaults.scale;
        });
        base.addEventListener('change', function () {
          settings.address = base.value || defaults.address;
          publish();
        });
        reset.addEventListener('click', function () {
          settings = { address: defaults.address, width: defaults.width, height: defaults.height, scale: defaults.scale };
          base.value = defaults.address;
          scale.value = String(defaults.scale);
          Array.prototype.forEach.call(document.querySelectorAll('.bitmap-preset'), function (button) {
            button.classList.toggle('active', button.dataset.width === '64' && button.dataset.height === '64');
          });
          draw();
          publish();
        });
        draw();
      }());
    </script>
  `);
}

function renderProgramView(state: SimStateMessage | undefined): string {
  if (!state) return renderIdleView('Program Listing', 'Assemble the active file to inspect compiled instructions.', ['machine code']);
  const rows = state.program ?? [];
  const activeRow = rows.find(row => row.address === state.pc) ?? rows[0];
  const renderedRows = rows.map(row => {
    const isCurrent = row.address === state.pc;
    return `
      <div class="program-line${isCurrent ? ' current' : ''}">
        <code class="program-address">${escapeHtml(row.address)}</code>
        <code class="program-machine">${escapeHtml(row.machine)}</code>
        <span class="program-instruction">
          <code>${escapeHtml(formatInstructionDisplay(row.assembly))}</code>
          ${isCurrent ? '<strong>Current</strong>' : ''}
        </span>
      </div>
    `;
  }).join('');
  const decodedFields = activeRow ? decodeProgramRow(activeRow, state.architecture).fields.map(field => `
    <span class="decoded-field">
      <span>${escapeHtml(fieldDisplayLabel(field))}</span>
      <code>${escapeHtml(formatFieldValue(field, 'hex'))}${field.alias ? ` ${escapeHtml(field.alias)}` : ''}</code>
    </span>
  `).join('') : '';

  return renderViewShell('Program Listing', `
    <div class="meta">${escapeHtml(state.architectureLabel)} · ${escapeHtml(state.fileName)} · ${escapeHtml(state.status)} · PC ${escapeHtml(state.pc)} · ${rows.length} instructions</div>
    ${rows.length === 0 ? '<p class="empty">No compiled program.</p>' : `
      <div class="program-panel">
        <div class="program-table native-section">
          <div class="program-head">
            <span>Address</span>
            <span>Machine</span>
            <span>Instruction</span>
          </div>
          <div class="program-rows">${renderedRows}</div>
        </div>

        ${activeRow ? `
          <div class="decoded-card native-section">
            <div class="decoded-top">
              <div>
                <div class="decoded-title">Decoded fields</div>
                <code>${escapeHtml(formatInstructionDisplay(activeRow.assembly))}</code>
              </div>
              <code>${escapeHtml(activeRow.address)}</code>
            </div>
            <div class="decoded-fields">${decodedFields}</div>
            <div class="decoded-source">Source line ${activeRow.sourceLine}: ${escapeHtml(activeRow.source)}</div>
          </div>
        ` : ''}
      </div>
    `}
  `);
}

function renderAnalysisView(state: SimStateMessage | undefined): string {
  if (!state) return renderIdleView('Cache Analysis', 'Run the active file to collect instruction counts.', ['arithmetic', 'memory', 'branch']);
  const stats = state.stats ?? emptyStats();
  const rows = (Object.keys(stats) as InstrCategory[]).map(key => `
    <tr>
      <td>${escapeHtml(key)}</td>
      <td>${stats[key]}</td>
    </tr>
  `).join('');
  return renderViewShell('Cache Analysis', `
    <div class="meta">${escapeHtml(state.architectureLabel)} · ${escapeHtml(state.fileName)} · ${state.totalInstructions ?? 0} executed instructions</div>
    <div class="summary-grid">
      <div class="summary-card"><span>Instructions</span><strong>${state.totalInstructions ?? 0}</strong></div>
      <div class="summary-card"><span>Cache hits</span><strong>${state.cache.hits}</strong></div>
      <div class="summary-card"><span>Cache misses</span><strong>${state.cache.misses}</strong></div>
    </div>
    <section class="native-section content-section">
      <div class="section-title">Instruction Mix</div>
      <table class="data-table analysis-table">
        <thead><tr><th>Category</th><th>Count</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `);
}

function renderViewShell(title: string, body: string): string {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          margin: 0;
          padding: 0;
          color: var(--vscode-foreground);
          background: var(--vscode-sideBar-background);
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size);
          min-width: 0;
          overflow-x: hidden;
        }
        * {
          box-sizing: border-box;
        }
        .view-shell {
          width: 100%;
          min-width: 0;
          padding: 14px;
          display: grid;
          gap: 12px;
          align-content: start;
        }
        h2 {
          margin: 0;
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--vscode-sideBarTitle-foreground);
          letter-spacing: 0;
        }
        .meta {
          color: var(--vscode-descriptionForeground);
          font-size: 11px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .empty,
        .empty-copy {
          color: var(--vscode-descriptionForeground);
          line-height: 1.45;
        }
        .empty-card {
          border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24));
          border-radius: 8px;
          padding: 16px;
          background: color-mix(in srgb, var(--vscode-sideBar-background) 82%, var(--vscode-editor-background));
          display: grid;
          gap: 8px;
        }
        .empty-mark {
          width: 28px;
          height: 28px;
          border: 1px solid var(--vscode-focusBorder, #3b82f6);
          border-radius: 7px;
          display: grid;
          place-items: center;
          color: var(--vscode-focusBorder, #3b82f6);
          font-weight: 800;
          font-size: 13px;
        }
        .empty-title {
          font-weight: 700;
          color: var(--vscode-sideBarTitle-foreground);
        }
        .empty-copy {
          margin: 0;
        }
        .empty-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 2px;
        }
        .empty-tags code {
          border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24));
          border-radius: 999px;
          padding: 2px 7px;
          color: var(--vscode-descriptionForeground);
          font-size: 11px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        th, td {
          border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24));
          padding: 8px 10px;
          text-align: left;
          vertical-align: top;
          overflow-wrap: anywhere;
        }
        th {
          color: var(--vscode-descriptionForeground);
          font-size: 10px;
          text-transform: uppercase;
        }
        code, pre {
          font-family: var(--vscode-editor-font-family);
          font-size: var(--vscode-editor-font-size);
        }
        .source {
          margin-top: 3px;
          color: var(--vscode-descriptionForeground);
          font-size: 11px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .native-section {
          border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24));
          border-radius: 6px;
          background: var(--vscode-sideBar-background);
          min-width: 0;
        }
        .content-section {
          width: 100%;
          overflow: hidden;
        }
        .section-title {
          padding: 8px 10px;
          border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24));
          color: var(--vscode-descriptionForeground);
          background: var(--vscode-sideBarSectionHeader-background, transparent);
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
          gap: 8px;
          width: 100%;
          min-width: 0;
        }
        .summary-card {
          border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24));
          border-radius: 6px;
          padding: 10px;
          display: grid;
          gap: 5px;
          min-width: 0;
        }
        .summary-card span {
          color: var(--vscode-descriptionForeground);
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .summary-card strong,
        .summary-card code {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .data-table code {
          overflow-wrap: anywhere;
        }
        .register-table th:nth-child(1),
        .register-table td:nth-child(1) {
          width: 28%;
        }
        .register-table th:nth-child(2),
        .register-table td:nth-child(2) {
          width: 16%;
        }
        .memory-table th:nth-child(1),
        .memory-table td:nth-child(1) {
          width: 46%;
        }
        .bitmap-panel,
        .program-panel {
          display: grid;
          gap: 12px;
          align-content: start;
          min-width: 0;
        }
        .bitmap-settings {
          overflow: hidden;
        }
        .bitmap-settings-grid {
          display: grid;
          grid-template-columns: minmax(150px, 1fr) minmax(84px, max-content);
          gap: 10px;
          padding: 10px;
          align-items: end;
        }
        .bitmap-field {
          display: grid;
          gap: 5px;
          min-width: 0;
        }
        .bitmap-field span,
        .bitmap-group-label,
        .decoded-title {
          color: var(--vscode-descriptionForeground);
          font-size: 11px;
          font-weight: 600;
        }
        .bitmap-field input,
        .bitmap-field select {
          width: 100%;
          height: 28px;
          box-sizing: border-box;
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24)));
          border-radius: 4px;
          padding: 3px 7px;
          color: var(--vscode-input-foreground);
          outline: none;
          font-size: 12px;
        }
        .bitmap-field input:focus,
        .bitmap-field select:focus,
        .bitmap-preset:focus,
        .bitmap-reset:focus {
          outline: 1px solid var(--vscode-focusBorder);
          outline-offset: 1px;
        }
        .bitmap-base-field input {
          font-family: var(--vscode-editor-font-family);
        }
        .bitmap-preset-group {
          display: grid;
          gap: 6px;
          padding: 0 10px 10px;
        }
        .bitmap-presets {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(76px, 1fr));
          border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24));
          border-radius: 6px;
          overflow: hidden;
        }
        .bitmap-preset,
        .bitmap-reset {
          min-height: 28px;
          border: 0;
          background: var(--vscode-button-secondaryBackground, transparent);
          color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
          font-size: 11px;
          font-weight: 600;
          padding: 5px 8px;
          cursor: pointer;
          white-space: nowrap;
        }
        .bitmap-preset {
          border-right: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24));
          border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24));
          border-radius: 0;
        }
        .bitmap-preset:hover,
        .bitmap-reset:hover {
          background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
        }
        .bitmap-preset.active {
          background: var(--vscode-list-activeSelectionBackground);
          color: var(--vscode-list-activeSelectionForeground);
        }
        .bitmap-actions {
          padding: 0 10px 10px;
          display: flex;
          justify-content: flex-end;
        }
        .bitmap-reset {
          border: 1px solid var(--vscode-button-border, var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24)));
          border-radius: 4px;
          min-height: 26px;
        }
        .bitmap-hint code {
          color: var(--vscode-foreground);
          font-size: 11px;
        }
        .bitmap-viewport {
          overflow: auto;
          padding: 10px;
          max-height: 52vh;
        }
        .bitmap-frame {
          width: max-content;
          border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24));
          border-radius: 4px;
          overflow: hidden;
          line-height: 0;
          background: #000;
        }
        .bitmap-hint {
          color: var(--vscode-descriptionForeground);
          font-size: 11px;
          line-height: 16px;
        }
        canvas {
          display: block;
          image-rendering: pixelated;
        }
        .program-table {
          overflow: auto;
        }
        .program-head,
        .program-line {
          display: grid;
          grid-template-columns: minmax(92px, .8fr) minmax(116px, 1fr) minmax(180px, 2fr);
          gap: 12px;
          align-items: start;
          min-width: min(100%, 520px);
        }
        .program-head {
          padding: 8px 10px;
          border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24));
          color: var(--vscode-descriptionForeground);
          background: var(--vscode-sideBarSectionHeader-background, transparent);
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .program-rows {
          max-height: 54vh;
          overflow: auto;
        }
        .program-line {
          padding: 9px 10px;
          border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.18));
        }
        .program-line:last-child {
          border-bottom: 0;
        }
        .program-line.current {
          background: var(--vscode-list-activeSelectionBackground);
          color: var(--vscode-list-activeSelectionForeground);
        }
        .program-line.current code,
        .program-line.current .program-address,
        .program-line.current .program-machine {
          color: var(--vscode-list-activeSelectionForeground);
        }
        .program-address,
        .program-machine {
          color: var(--vscode-descriptionForeground);
          line-height: 16px;
          white-space: pre-line;
        }
        .program-machine,
        .program-instruction code {
          color: var(--vscode-foreground);
        }
        .program-instruction {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          min-width: 0;
          flex-wrap: wrap;
        }
        .program-instruction code {
          min-width: 0;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .program-instruction strong {
          border: 1px solid currentColor;
          border-radius: 999px;
          padding: 0 5px;
          color: inherit;
          font-size: 10px;
          font-weight: 700;
          white-space: nowrap;
        }
        .decoded-card {
          padding: 10px;
        }
        .decoded-top {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .decoded-top code {
          display: block;
          margin-top: 2px;
          color: var(--vscode-foreground);
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .decoded-fields {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 8px;
        }
        .decoded-field {
          border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24));
          border-radius: 4px;
          padding: 3px 6px;
          display: inline-grid;
          gap: 1px;
          color: var(--vscode-descriptionForeground);
          font-size: 10px;
        }
        .decoded-field code {
          color: var(--vscode-foreground);
          font-size: 11px;
        }
        .decoded-source {
          margin-top: 8px;
          color: var(--vscode-descriptionForeground);
          font-size: 11px;
          line-height: 16px;
          overflow-wrap: anywhere;
        }
        pre {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          color: var(--vscode-editor-foreground);
        }
        @media (max-width: 280px) {
          .view-shell {
            padding: 10px;
          }
          .summary-grid {
            grid-template-columns: 1fr;
          }
          th, td {
            padding: 7px 8px;
          }
          .program-head,
          .program-line {
            grid-template-columns: 1fr;
            gap: 4px;
            min-width: 0;
          }
          .program-head span:nth-child(2),
          .program-head span:nth-child(3) {
            display: none;
          }
          .bitmap-settings-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </head>
    <body>
      <main class="view-shell">
        <h2>${escapeHtml(title)}</h2>
        ${body}
      </main>
    </body>
  </html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
