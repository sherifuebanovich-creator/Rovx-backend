import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { USER_ROLES, UserRole } from '../constants/roles';
import { ROLES_KEY } from '../guards/roles.guard';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
