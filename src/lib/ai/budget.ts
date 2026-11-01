/**
 * Hard daily AI spend cap (AI_DAILY_CAP_USD, default $2).
 *
 * reserve(worstCase) before every call -> refuses when spent + in-flight + worstCase > cap.
 * commit(reservation, actual) after the call. Spend persists in .data/ai-spend.json per UTC day.
 */
import { randomUUID } from "node:crypto";
import { getEnv } from "../env";
import { singleton } from "../singleton";
import { dataPath, readJsonFile, writeJsonFile } from "../store/files";
import { AiBudgetExceededError } from "./errors";

interface SpendFile {
  day: string;
  spentUsd: number;
  calls: number;
}

export interface BudgetStatus {
  day: string;
  capUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  calls: number;
}

export interface Reservation {
  id: string;
  estimateUsd: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export class SpendBudget {
  private reserved = new Map<string, number>();
  constructor(
    private readonly file: string,
    private readonly capUsd: () => number,
  ) {}

  private read(): SpendFile {
    const data = readJsonFile<SpendFile>(this.file, { day: today(), spentUsd: 0, calls: 0 });
    return data.day === today() ? data : { day: today(), spentUsd: 0, calls: 0 };
  }

  status(): BudgetStatus {
    const data = this.read();
    const reservedUsd = [...this.reserved.values()].reduce((a, b) => a + b, 0);
    const capUsd = this.capUsd();
    return { day: data.day, capUsd, spentUsd: data.spentUsd, reservedUsd, remainingUsd: Math.max(0, capUsd - data.spentUsd - reservedUsd), calls: data.calls };
  }

  reserve(estimateUsd: number): Reservation {
    const s = this.status();
    if (s.spentUsd + s.reservedUsd + estimateUsd > s.capUsd) {
      throw new AiBudgetExceededError(s.capUsd, s.spentUsd + s.reservedUsd, estimateUsd);
    }
    const id = randomUUID();
    this.reserved.set(id, estimateUsd);
    return { id, estimateUsd };
  }

  commit(reservation: Reservation, actualUsd: number) {
    this.reserved.delete(reservation.id);
    const data = this.read();
    writeJsonFile(this.file, { day: data.day, spentUsd: Number((data.spentUsd + actualUsd).toFixed(6)), calls: data.calls + 1 });
  }

  release(reservation: Reservation) {
    this.reserved.delete(reservation.id);
  }
}

export function getBudget(): SpendBudget {
  return singleton("ai:budget", () => new SpendBudget(dataPath("ai-spend.json"), () => getEnv().aiDailyCapUsd));
}
