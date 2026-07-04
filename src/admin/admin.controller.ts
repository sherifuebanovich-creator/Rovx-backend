import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/current-user.decorator';
import { USER_ROLES } from '../common/constants/roles';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(USER_ROLES.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard stats' })
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  // Users
  @Get('users')
  async getUsers(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('search') search?: string,
    @Query('role') role?: string,
  ) {
    return this.adminService.getUsers(+page, +limit, search, role);
  }

  @Get('users/:id')
  async getUserDetail(@Param('id') id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Post('users/:id/ban')
  async banUser(@Param('id') id: string, @Body('reason') reason: string) {
    return this.adminService.banUser(id, reason);
  }

  @Post('users/:id/unban')
  async unbanUser(@Param('id') id: string) {
    return this.adminService.unbanUser(id);
  }

  @Put('users/:id/role')
  async updateRole(@Param('id') id: string, @Body('role') role: string) {
    return this.adminService.updateUserRole(id, role);
  }

  // Reports
  @Get('reports')
  async getReports(
    @Query('page') page = 1,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.adminService.getReports(+page, 20, status, type);
  }

  @Put('reports/:id/status')
  async moderateReport(@Param('id') id: string, @Body('status') status: string) {
    return this.adminService.moderateReport(id, status);
  }

  // Map Objects
  @Get('map-objects')
  async getMapObjects(@Query('page') page = 1, @Query('category') category?: string) {
    return this.adminService.getMapObjects(+page, 20, category);
  }

  @Post('map-objects')
  async createMapObject(@Body() data: any) {
    return this.adminService.createMapObject(data);
  }

  @Put('map-objects/:id')
  async updateMapObject(@Param('id') id: string, @Body() data: any) {
    return this.adminService.updateMapObject(id, data);
  }

  @Delete('map-objects/:id')
  async deleteMapObject(@Param('id') id: string) {
    return this.adminService.deleteMapObject(id);
  }

  // Analytics
  @Get('analytics/subscriptions')
  async getSubscriptionStats() {
    return this.adminService.getSubscriptionStats();
  }

  // Ads
  @Get('ads')
  async getAds(@Query('page') page = 1) {
    return this.adminService.getAds(+page);
  }

  @Post('ads')
  async createAd(@Body() data: any) {
    return this.adminService.createAd(data);
  }

  @Put('ads/:id')
  async updateAd(@Param('id') id: string, @Body() data: any) {
    return this.adminService.updateAd(id, data);
  }

  @Post('ads/:id/toggle')
  async toggleAd(@Param('id') id: string) {
    return this.adminService.toggleAd(id);
  }
}
