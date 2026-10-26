import { Prisma } from "../../generated/prisma/client";

export type ErrorCode = 400 | 401 | 403 | 404 | 409 | 422 | 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AppError extends Error {
  readonly status: ErrorCode;

  constructor(status: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

/** Reject malformed UUIDs before Prisma turns them into 500s. */
export function requireUuid(value: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new AppError(400, "Invalid input");
  }
  return value;
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new AppError(400, "Invalid input");
  }
}

function isInvalidInputError(error: unknown): boolean {
  if (error instanceof SyntaxError) return true;
  if (error instanceof Prisma.PrismaClientValidationError) return true;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2023" || error.code === "P2014")
  ) {
    return true;
  }
  const text = error instanceof Error ? error.message : String(error);
  return (
    /invalid input syntax for type uuid/i.test(text) ||
    /Error creating UUID/i.test(text) ||
    /invalid.*uuid/i.test(text)
  );
}

export function jsonError(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (isInvalidInputError(error)) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  console.error(error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
