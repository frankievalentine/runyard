import { expect, test } from "bun:test";
import { GithubHttp } from "./client.ts";

test("the remaining count only falls within an hour, whatever order responses arrive in", async () => {
  const answers = [
    { remaining: 6610, reset: 1000 },
    { remaining: 6608, reset: 1000 },
    { remaining: 6609, reset: 1000 }, // older news, arriving late
    { remaining: 6700, reset: 4600 }, // a new hour
  ];
  let i = 0;
  const http = new GithubHttp(
    async () => {
      const a = answers[i++]!;
      return Response.json(
        {},
        {
          headers: {
            "x-ratelimit-limit": "6700",
            "x-ratelimit-remaining": String(a.remaining),
            "x-ratelimit-reset": String(a.reset),
          },
        },
      );
    },
    "https://api.github.test",
    async () => "token",
  );
  const seen: number[] = [];
  for (let n = 0; n < answers.length; n++) {
    await http.get(`/x${n}`);
    seen.push(http.rateLimit!.remaining);
  }
  expect(seen).toEqual([6610, 6608, 6608, 6700]);
});
