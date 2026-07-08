import { availableUpgradeOptions, createUpgradeRanks, type UpgradeId, type UpgradeRanks } from "./upgrades";

export type PlayerProgressionSnapshot = {
  level: number;
  xp: number;
  xpToNextLevel: number;
  unspentUpgradePoints: number;
  upgrades: UpgradeRanks;
};

export class PlayerProgression {
  private levelValue = 1;
  private xpValue = 0;
  private unspentUpgradePointsValue = 0;
  private readonly upgradesValue = createUpgradeRanks();
  private readonly hudStateValue: Pick<
    PlayerProgressionSnapshot,
    "level" | "xp" | "xpToNextLevel" | "unspentUpgradePoints"
  > = {
    level: 1,
    xp: 0,
    xpToNextLevel: xpToNextLevel(1),
    unspentUpgradePoints: 0,
  };

  get level(): number {
    return this.levelValue;
  }

  get xp(): number {
    return this.xpValue;
  }

  get xpToNextLevel(): number {
    return xpToNextLevel(this.levelValue);
  }

  get unspentUpgradePoints(): number {
    return this.unspentUpgradePointsValue;
  }

  get upgrades(): UpgradeRanks {
    return { ...this.upgradesValue };
  }

  get currentUpgrades(): UpgradeRanks {
    return this.upgradesValue;
  }

  get hudState(): Pick<PlayerProgressionSnapshot, "level" | "xp" | "xpToNextLevel" | "unspentUpgradePoints"> {
    this.hudStateValue.level = this.levelValue;
    this.hudStateValue.xp = this.xpValue;
    this.hudStateValue.xpToNextLevel = this.xpToNextLevel;
    this.hudStateValue.unspentUpgradePoints = this.unspentUpgradePointsValue;
    return this.hudStateValue;
  }

  grantXp(amount: number): number {
    if (amount <= 0) return 0;
    this.xpValue += amount;

    let levelsGained = 0;
    while (this.xpValue >= this.xpToNextLevel) {
      this.xpValue -= this.xpToNextLevel;
      this.levelValue += 1;
      this.unspentUpgradePointsValue += 1;
      levelsGained += 1;
    }

    return levelsGained;
  }

  reset(): void {
    this.levelValue = 1;
    this.xpValue = 0;
    this.unspentUpgradePointsValue = 0;
    for (const id of Object.keys(this.upgradesValue) as UpgradeId[]) {
      this.upgradesValue[id] = 0;
    }
  }

  spendUpgrade(id: UpgradeId): boolean {
    if (this.unspentUpgradePointsValue <= 0) return false;
    if (!availableUpgradeOptions(this.upgradesValue, this.levelValue).some((option) => option.id === id)) return false;

    this.upgradesValue[id] += 1;
    this.unspentUpgradePointsValue -= 1;
    return true;
  }

  snapshot(): PlayerProgressionSnapshot {
    return {
      level: this.levelValue,
      xp: this.xpValue,
      xpToNextLevel: this.xpToNextLevel,
      unspentUpgradePoints: this.unspentUpgradePointsValue,
      upgrades: this.upgrades,
    };
  }
}

export function xpToNextLevel(level: number): number {
  return 100 + Math.max(0, level - 1) * 75;
}
