import { Injectable, NotFoundException } from '@nestjs/common';
import { Material, MaterialVisibility, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../common/decorators/access.decorators';
import { Permission, roleHasPermission } from '../common/security/permissions';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Object-level authorisation for materials (prevents IDOR). Staff can read
 * everything; students read PUBLISHED materials plus their own private uploads.
 */
@Injectable()
export class MaterialAccessPolicy {
  constructor(private readonly prisma: PrismaService) {}

  buildReadableMaterialsFilter(user: AuthenticatedUser): Prisma.MaterialWhereInput {
    if (roleHasPermission(user.role, Permission.MaterialsReadAll)) return {};
    return {
      OR: [{ visibility: MaterialVisibility.PUBLISHED }, { uploadedById: user.id }],
    };
  }

  canReadMaterial(user: AuthenticatedUser, material: Pick<Material, 'uploadedById' | 'visibility'>) {
    return (
      roleHasPermission(user.role, Permission.MaterialsReadAll) ||
      material.visibility === MaterialVisibility.PUBLISHED ||
      material.uploadedById === user.id
    );
  }

  canDeleteMaterial(user: AuthenticatedUser, material: Pick<Material, 'uploadedById'>) {
    return (
      material.uploadedById === user.id ||
      roleHasPermission(user.role, Permission.MaterialsModerate)
    );
  }

  /** Returns 404 (not 403) for unreadable materials so existence is not leaked. */
  async getReadableMaterialOrThrow(user: AuthenticatedUser, materialId: string): Promise<Material> {
    const material = await this.prisma.material.findUnique({ where: { id: materialId } });
    if (!material || !this.canReadMaterial(user, material)) throw new NotFoundException();
    return material;
  }
}
