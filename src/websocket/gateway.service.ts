import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);
  private server: Server;

  setServer(server: Server) {
    this.server = server;
  }

  async broadcastReport(report: any) {
    if (!this.server) return;

    // Broadcast to users in the area (5km radius grid cell)
    const gridCell = this.getGridCell(report.lat, report.lng);
    const room = `area:${gridCell}`;

    this.server.to(room).emit('report:new', {
      id: report.id,
      type: report.type,
      lat: report.lat,
      lng: report.lng,
      severity: report.severity,
      description: report.description,
      createdAt: report.createdAt,
    });

    this.logger.log(`Broadcast report ${report.id} to ${room}`);
  }

  async broadcastTrafficUpdate(segment: any) {
    if (!this.server) return;
    const gridCell = this.getGridCell(segment.startLat, segment.startLng);
    this.server.to(`area:${gridCell}`).emit('traffic:update', segment);
  }

  async sendToUser(userId: string, event: string, data: any) {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit(event, data);
  }

  async broadcastToGroup(groupId: string, event: string, data: any) {
    if (!this.server) return;
    this.server.to(`group:${groupId}`).emit(event, data);
  }

  private getGridCell(lat: number, lng: number): string {
    // ~5km grid cells
    const gridLat = Math.floor(lat / 0.045) * 0.045;
    const gridLng = Math.floor(lng / 0.045) * 0.045;
    return `${gridLat.toFixed(3)},${gridLng.toFixed(3)}`;
  }
}
