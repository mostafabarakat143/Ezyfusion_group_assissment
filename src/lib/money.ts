export function toSenNumber(value: bigint | number | string): number {
  const sen = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(sen)) {
    throw new Error("Amount exceeds safe integer range");
  }
  return sen;
}

export function toSenBigInt(value: number): bigint {
  if (!Number.isInteger(value)) {
    throw new Error("Amount must be an integer number of sen");
  }
  return BigInt(value);
}

/** Format integer sen as `RM 1,234.56` for display. */
export function formatRinggit(sen: number): string {
  const ringgit = sen / 100;
  return `RM ${ringgit.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
