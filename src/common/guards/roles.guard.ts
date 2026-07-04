import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { USER_ROLES, UserRole } from '../constants/roles';

export const ROLES_KEY = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Not authenticated');

    const roleHierarchy: Record<UserRole, number> = {
      [USER_ROLES.USER]: 1,
      [USER_ROLES.MODERATOR]: 2,
      [USER_ROLES.ADMIN]: 3,
      [USER_ROLES.SUPERADMIN]: 4,
    };

    const userLevel = roleHierarchy[user.role as UserRole] || 0;
    const requiredLevel = Math.min(...requiredRoles.map((r) => roleHierarchy[r]));

    if (userLevel < requiredLevel) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
