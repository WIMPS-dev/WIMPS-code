// Example programs from the classic WIMPS FileExplorer.
export const examples = [
  {
    "name": "hello.mips",
    "description": "Hello, World!",
    "code": "# Hello, World!\n.data\nmsg: .asciiz \"Hello, World!\\n\"\n\n.text\nmain:\n    li   $v0, 4\n    la   $a0, msg\n    syscall\n\n    li   $v0, 10\n    syscall"
  },
  {
    "name": "quadhex.mips",
    "description": "QuadHex — like FizzBuzz, but for 4, 6, and 24",
    "code": "# QuadHex — like FizzBuzz, but for 4, 6, and 24\n.data\nstr_quad:    .asciiz \"Quad\"\nstr_hex:     .asciiz \"Hex\"\nstr_quadhex: .asciiz \"QuadHex\"\nstr_newline: .asciiz \"\\n\"\n\n.text\nmain:\n    li   $t0, 1          # counter\n    li   $t1, 40         # limit\n\nloop:\n    bgt  $t0, $t1, done\n\n    # divisible by 24?\n    li   $t2, 24\n    div  $t0, $t2\n    mfhi $t3\n    beqz $t3, print_quadhex\n\n    # divisible by 6?\n    li   $t2, 6\n    div  $t0, $t2\n    mfhi $t3\n    beqz $t3, print_hex\n\n    # divisible by 4?\n    li   $t2, 4\n    div  $t0, $t2\n    mfhi $t3\n    beqz $t3, print_quad\n\n    # otherwise: print the number\n    li   $v0, 1\n    move $a0, $t0\n    syscall\n    j    next\n\nprint_quadhex:\n    li   $v0, 4\n    la   $a0, str_quadhex\n    syscall\n    j    next\n\nprint_hex:\n    li   $v0, 4\n    la   $a0, str_hex\n    syscall\n    j    next\n\nprint_quad:\n    li   $v0, 4\n    la   $a0, str_quad\n    syscall\n\nnext:\n    li   $v0, 4\n    la   $a0, str_newline\n    syscall\n    addi $t0, $t0, 1\n    j    loop\n\ndone:\n    li   $v0, 10\n    syscall"
  },
  {
    "name": "smile.mips",
    "description": "Smiley face — open the Bitmap tab (64×64, scale 4)",
    "code": "# smile.mips — smiley face drawn pixel by pixel\n# Open the Bitmap tab, set 64x64 at scale 4, then run.\n# Pixel format: 0x00RRGGBB stored at base + (y*64 + x)*4\n.text\nmain:\n    li   $s0, 0x10010000   # bitmap base address\n\n    li   $t0, 0            # y = 0\nyloop:\n    li   $t1, 0            # x = 0\nxloop:\n    # Squared distance from face center (32, 32)\n    addi $t2, $t0, -32\n    addi $t3, $t1, -32\n    mul  $t4, $t2, $t2     # dy^2\n    mul  $t5, $t3, $t3     # dx^2\n    add  $t6, $t4, $t5     # face r^2\n\n    # Default: steel-blue background\n    li   $s1, 0x006699CC\n    li   $t9, 576          # 24^2 — face outer edge\n    bgt  $t6, $t9, write\n\n    # Dark outline ring: 22^2 < r^2 <= 24^2\n    li   $s1, 0x00222222\n    li   $t9, 484          # 22^2\n    bgt  $t6, $t9, write\n\n    # Yellow face fill\n    li   $s1, 0x00FFD700\n\n    # Left eye: center (24, 24), radius 4\n    addi $t2, $t0, -24\n    addi $t3, $t1, -24\n    mul  $t4, $t2, $t2\n    mul  $t5, $t3, $t3\n    add  $t7, $t4, $t5\n    li   $t9, 16\n    ble  $t7, $t9, feature\n\n    # Right eye: center (40, 24), radius 4\n    addi $t2, $t0, -24\n    addi $t3, $t1, -40\n    mul  $t4, $t2, $t2\n    mul  $t5, $t3, $t3\n    add  $t7, $t4, $t5\n    ble  $t7, $t9, feature\n\n    # Smile arc: center (32, 36), ring r=10..13, lower arc only\n    addi $t2, $t0, -36\n    addi $t3, $t1, -32\n    mul  $t4, $t2, $t2\n    mul  $t5, $t3, $t3\n    add  $t7, $t4, $t5\n    blt  $t0, 36, write\n    li   $t9, 100\n    blt  $t7, $t9, write\n    li   $t9, 169\n    bgt  $t7, $t9, write\nfeature:\n    li   $s1, 0x00222222\n\nwrite:\n    sll  $t2, $t0, 6       # y * 64\n    add  $t2, $t2, $t1     # + x\n    sll  $t2, $t2, 2       # * 4\n    add  $t2, $t2, $s0     # + base\n    sw   $s1, 0($t2)\n\n    addi $t1, $t1, 1\n    slti $t9, $t1, 64\n    bnez $t9, xloop\n\n    addi $t0, $t0, 1\n    slti $t9, $t0, 64\n    bnez $t9, yloop\n\n    li   $v0, 10\n    syscall"
  },
  {
    "name": "hello.riscv",
    "description": "RISC-V Hello, World!",
    "code": ".data\nmsg: .asciz \"Hello, RISC-V!\\n\"\n\n.text\nmain:\n    li a7, 4\n    la a0, msg\n    ecall\n\n    li a7, 10\n    ecall"
  },
  {
    "name": "exit.x86",
    "description": "x86 NASM exit program",
    "code": "global _start\n\nsection .text\n_start:\n    mov rax, 60\n    xor rdi, rdi\n    syscall"
  }
];
