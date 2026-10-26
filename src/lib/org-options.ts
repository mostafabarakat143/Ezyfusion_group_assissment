import { type Actor, requireManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Units and tenants for the manager's organization (create-lease form). */
export async function listOrgLeaseOptions(actor: Actor) {
  requireManager(actor);

  const [units, tenants, leases] = await Promise.all([
    prisma.unit.findMany({
      where: { orgId: actor.orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.tenant.findMany({
      where: { orgId: actor.orgId },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, email: true },
    }),
    prisma.lease.findMany({
      where: { orgId: actor.orgId },
      select: { unitId: true },
    }),
  ]);

  const occupiedUnitIds = new Set(leases.map((lease) => lease.unitId));

  // Vacant units first so Create lease defaults to a unit that can accept a lease.
  const orderedUnits = [...units].sort((a, b) => {
    const aOcc = occupiedUnitIds.has(a.id) ? 1 : 0;
    const bOcc = occupiedUnitIds.has(b.id) ? 1 : 0;
    if (aOcc !== bOcc) return aOcc - bOcc;
    return a.name.localeCompare(b.name);
  });

  return {
    units: orderedUnits.map((unit) => ({
      id: unit.id,
      name: unit.name,
      occupied: occupiedUnitIds.has(unit.id),
    })),
    tenants,
  };
}
