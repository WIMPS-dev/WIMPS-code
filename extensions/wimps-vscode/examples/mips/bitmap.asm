.data
pixels:
  .word 0x00E53935
  .word 0x0043A047
  .word 0x001E88E5
  .word 0x00FDD835

.text
main:
  la $t0, pixels
  lw $t1, 0($t0)
  sw $t1, 0($t0)
  lw $t1, 4($t0)
  sw $t1, 4($t0)
  lw $t1, 8($t0)
  sw $t1, 8($t0)
  lw $t1, 12($t0)
  sw $t1, 12($t0)

  li $v0, 10
  syscall
