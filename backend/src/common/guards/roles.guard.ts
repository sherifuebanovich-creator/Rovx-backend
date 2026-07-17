import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE_HIERARCHY, UserRole } from '../constants/roles';

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

    const userLevel = ROLE_HIERARCHY[user.role as UserRole] || 0;
    const requiredLevel = Math.min(...requiredRoles.map((r) => ROLE_HIERARCHY[r]));

    if (userLevel < requiredLevel) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
