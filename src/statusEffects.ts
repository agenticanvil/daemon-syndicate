export type StatusEffectKind = "invulnerable" | "slow" | "burn" | "stun" | "shield";

export type StatusEffect = {
  kind: StatusEffectKind;
  remaining: number;
  magnitude?: number;
  sourceId?: number;
};

export function tickStatusEffects(effects: StatusEffect[], dt: number): void {
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    effects[i].remaining -= dt;
    if (effects[i].remaining <= 0) {
      effects.splice(i, 1);
    }
  }
}

export function hasStatusEffect(effects: readonly StatusEffect[], kind: StatusEffectKind): boolean {
  return effects.some((effect) => effect.kind === kind && effect.remaining > 0);
}

export function setStatusEffect(effects: StatusEffect[], next: StatusEffect): void {
  const existing = effects.find((effect) => effect.kind === next.kind && effect.sourceId === next.sourceId);
  if (existing) {
    existing.remaining = next.remaining;
    existing.magnitude = next.magnitude;
    existing.sourceId = next.sourceId;
    return;
  }

  effects.push({ ...next });
}
