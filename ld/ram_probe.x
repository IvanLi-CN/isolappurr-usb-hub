/*
 * Linker entry point for board-topology-probe.
 *
 * Unlike the application image, this ELF is transferred by the ESP32-S3 ROM
 * into SRAM and executed in place. The esp-hal section scripts are retained so
 * startup symbols and interrupt vectors have the same contract as the normal
 * image, while ROTEXT and RODATA are deliberately redirected to SRAM.
 */
INCLUDE "memory.x"

REGION_ALIAS("ROTEXT", iram_seg);
REGION_ALIAS("RWTEXT", iram_seg);
/* Keep the downloader's DRAM workspace untouched until MEM_END. */
REGION_ALIAS("RODATA", iram_seg);
REGION_ALIAS("RWDATA", iram_seg);
REGION_ALIAS("RTC_FAST_RWTEXT", rtc_fast_seg);
REGION_ALIAS("RTC_FAST_RWDATA", rtc_fast_seg);

INCLUDE "esp32s3.x"
INCLUDE "hal-defaults.x"
