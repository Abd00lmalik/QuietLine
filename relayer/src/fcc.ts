import { hexToString, stringToHex, type Hex } from "viem";

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
    attempts = 20,
  ): Promise<ActionResponse> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const response = await fetch(
        `${this.baseUrl}/action/result/${actionId}?submissionTag=${tag}`,
      );
      if (response.ok) {
        const body = (await response.json()) as ActionResponse;
        if (body.result.status === 2) {
          await delay(Math.min(150 * 2 ** attempt, 2_000));
          continue;
        }
        return body;
      }
      await delay(Math.min(150 * 2 ** attempt, 2_000));
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
