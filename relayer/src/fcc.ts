import { hexToString, stringToHex, type Hex } from "viem";
import { publicKeyToAddress } from "viem/accounts";

export type SubmissionTag = "submit" | "threshold" | "end";
export type ActionResponse = {
  result: { status: number; log: string; data?: Hex };
};

const bytes32 = (value: string) => stringToHex(value, { size: 32 });

export class FccClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  async info(): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/info`);
    if (!response.ok) throw new Error(`FCC info returned ${response.status}`);
    return response.json();
  }

  async machineSigner() {
    const info = (await this.info()) as {
      teeInfo?: { publicKey?: { x?: string; y?: string } };
      machineData?: { publicKey?: { x?: string; y?: string } };
    };
    const key = info.machineData?.publicKey ?? info.teeInfo?.publicKey;
    if (
      !key?.x ||
      !key.y ||
      !/^0x[0-9a-fA-F]{64}$/u.test(key.x) ||
      !/^0x[0-9a-fA-F]{64}$/u.test(key.y)
    ) {
      throw new Error("FCC /info did not include a valid secp256k1 public key");
    }
    return publicKeyToAddress(
      `0x04${key.x.slice(2)}${key.y.slice(2)}` as Hex,
    );
  }

  submitCiphertext(command: string, ciphertext: Hex) {
    return this.submitRaw(command, ciphertext);
  }

  submitJson(command: string, payload: unknown) {
    return this.submitRaw(command, stringToHex(JSON.stringify(payload)));
  }

  async submitRaw(command: string, message: Hex): Promise<Hex> {
    const response = await fetch(`${this.baseUrl}/direct`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({
        opType: bytes32("CREDIT"),
        opCommand: bytes32(command),
        message,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `FCC direct submission returned ${response.status}: ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { data?: { id?: Hex } };
    if (!body.data?.id) throw new Error("FCC direct submission omitted action id");
    return body.data.id;
  }

  async poll(
    actionId: Hex,
    tag: SubmissionTag = "submit",
    timeoutMs = 300_000,
  ): Promise<ActionResponse> {
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      const response = await fetch(
        `${this.baseUrl}/action/result/${actionId}?submissionTag=${tag}`,
      );
      if (response.ok) {
        const body = (await response.json()) as ActionResponse;
        if (body.result.status === 2) {
          await delay(Math.min(250 * 1.5 ** attempt++, 3_000));
          continue;
        }
        return body;
      }
      await delay(Math.min(250 * 1.5 ** attempt++, 3_000));
    }
    throw new Error(`timed out waiting for FCC action ${actionId}`);
  }

  decode<T>(data: Hex | undefined): T {
    if (!data || data === "0x") throw new Error("FCC result did not include data");
    return JSON.parse(hexToString(data)) as T;
  }
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
