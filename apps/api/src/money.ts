export function priceForMinutes(hourlyCents: number, minutes: number) {
  if (
    !Number.isSafeInteger(hourlyCents) ||
    !Number.isSafeInteger(minutes) ||
    hourlyCents < 0 ||
    minutes < 0
  )
    throw new Error("Importe o minutos inválidos");
  const product = hourlyCents * minutes;
  if (!Number.isSafeInteger(product)) throw new Error("Importe fuera de rango");
  return Math.ceil(product / 60);
}
/** Cobro comercial por bloques de 15 minutos. Los importes se expresan en céntimos. */
export function priceForBlocks(
  hourlyCents: number,
  stationType: string,
  minutes: number,
) {
  if (!Number.isSafeInteger(hourlyCents) || hourlyCents <= 0 || !Number.isSafeInteger(minutes) || minutes <= 0)
    throw new Error("Importe o minutos inválidos");
  const blocks = Math.ceil(minutes / 15);
  const fullHours = Math.floor(blocks / 4);
  const remainder = blocks % 4;
  if (remainder === 0) return fullHours * hourlyCents;
  if (stationType === "PS5" && hourlyCents === 500) {
    const ps5Blocks = [0, 150, 250, 400];
    return fullHours * hourlyCents + ps5Blocks[remainder]!;
  }
  const blockCents = Math.ceil(hourlyCents / 4);
  return fullHours * hourlyCents + remainder * blockCents;
}
/**
 * Cobro de una sesión libre: la primera hora usa bloques normales; después,
 * los primeros diez minutos de cada hora incompleta no generan un bloque nuevo.
 */
export function priceForOpenMinutes(
  hourlyCents: number,
  stationType: string,
  minutes: number,
) {
  if (
    !Number.isSafeInteger(hourlyCents) ||
    hourlyCents <= 0 ||
    !Number.isSafeInteger(minutes) ||
    minutes < 0
  )
    throw new Error("Importe o minutos inválidos");
  const fullHours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (fullHours === 0)
    return priceForBlocks(hourlyCents, stationType, Math.max(1, minutes));
  if (remainder < 10) return fullHours * hourlyCents;
  return fullHours * hourlyCents + priceForBlocks(hourlyCents, stationType, remainder);
}
export function elapsedMinutes(startedAt: Date, now: Date) {
  return Math.max(1, Math.ceil((now.getTime() - startedAt.getTime()) / 60000));
}
export function elapsedWholeMinutes(startedAt: Date, now: Date) {
  return Math.max(1, Math.floor((now.getTime() - startedAt.getTime()) / 60000));
}
export function sessionTotal(
  base: number,
  extensions: readonly { amount: number }[],
  extras: readonly { total: number }[],
) {
  return (
    base +
    extensions.reduce((s, e) => s + e.amount, 0) +
    extras.reduce((s, e) => s + e.total, 0)
  );
}
