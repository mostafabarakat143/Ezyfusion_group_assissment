import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { createCookieClient } from "@/lib/supabase/cookies";
import { createUserClient } from "@/lib/supabase/server";

export type MembershipRole = "manager" | "staff";

export type Actor =
  | {
      kind: "membership";
      userId: string;
      orgId: string;
      role: MembershipRole;
    }
  | {
      kind: "tenant";
      userId: string;
      orgId: string;
      tenantId: string;
    };

/**
 * Authenticate with getUser() and resolve role/org from memberships or tenants.
 * Never trust user_metadata for authorization.
 */
export async function requireActor(request: Request): Promise<Actor> {
  const supabase = await createUserClient(request);
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  const {
    data: { user },
    error,
  } = bearer
    ? await supabase.auth.getUser(bearer)
    : await supabase.auth.getUser();

  if (error || !user) {
    throw new AppError(401, "Unauthenticated");
  }

  const membership = await prisma.membership.findUnique({
    where: { userId: user.id },
  });
  if (membership) {
    return {
      kind: "membership",
      userId: user.id,
      orgId: membership.orgId,
      role: membership.role,
    };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { userId: user.id },
  });
  if (tenant) {
    return {
      kind: "tenant",
      userId: user.id,
      orgId: tenant.orgId,
      tenantId: tenant.id,
    };
  }

  throw new AppError(401, "Unauthenticated");
}

/** Resolve the signed-in actor from the session cookie (Server Components). */
export async function requirePageActor(): Promise<Actor> {
  const supabase = await createCookieClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AppError(401, "Unauthenticated");
  }

  const membership = await prisma.membership.findUnique({
    where: { userId: user.id },
  });
  if (membership) {
    return {
      kind: "membership",
      userId: user.id,
      orgId: membership.orgId,
      role: membership.role,
    };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { userId: user.id },
  });
  if (tenant) {
    return {
      kind: "tenant",
      userId: user.id,
      orgId: tenant.orgId,
      tenantId: tenant.id,
    };
  }

  throw new AppError(401, "Unauthenticated");
}

export function requireManager(actor: Actor): asserts actor is {
  kind: "membership";
  userId: string;
  orgId: string;
  role: "manager";
} {
  if (actor.kind !== "membership" || actor.role !== "manager") {
    throw new AppError(403, "Forbidden");
  }
}

export function requireStaffOrManager(actor: Actor): asserts actor is {
  kind: "membership";
  userId: string;
  orgId: string;
  role: MembershipRole;
} {
  if (actor.kind !== "membership") {
    throw new AppError(403, "Forbidden");
  }
}

export function isLeaseReadableBy(
  actor: Actor,
  lease: { orgId: string; tenantId: string },
): boolean {
  if (actor.kind === "membership") {
    return actor.orgId === lease.orgId;
  }
  return actor.tenantId === lease.tenantId;
}
