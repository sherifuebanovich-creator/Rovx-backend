import { IsNumber, IsOptional, IsEnum, IsString, IsArray, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
const RouteType = {
  FASTEST: 'FASTEST',
  SHORTEST: 'SHORTEST',
  SAFEST: 'SAFEST',
  SCENIC: 'SCENIC',
  CHEAPEST: 'CHEAPEST',
  NO_TRAFFIC: 'NO_TRAFFIC',
  NO_TOLLS: 'NO_TOLLS',
  ECONOMICAL: 'ECONOMICAL',
  TOURIST: 'TOURIST',
  FAMILY: 'FAMILY',
  NIGHT: 'NIGHT',
  TRUCK: 'TRUCK',
  CUSTOM: 'CUSTOM',
} as const;
type RouteType = (typeof RouteType)[keyof typeof RouteType];

export class WaypointDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsOptional()
  @IsString()
  name?: string;
}

export class CalculateRouteDto {
  @ApiProperty({ example: 55.7558 })
  @IsNumber()
  originLat: number;

  @ApiProperty({ example: 37.6173 })
  @IsNumber()
  originLng: number;

  @ApiProperty({ example: 59.9343 })
  @IsNumber()
  destLat: number;

  @ApiProperty({ example: 30.3351 })
  @IsNumber()
  destLng: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  waypoints?: WaypointDto[];

  @ApiPropertyOptional({ enum: RouteType })
  @IsOptional()
  @IsEnum(RouteType)
  routeType?: RouteType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vehicleType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  avoidTolls?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  avoidHighways?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fuelPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  vehicleHeight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  vehicleWeight?: number;
}

export class SaveRouteDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  originName: string;

  @IsNumber()
  originLat: number;

  @IsNumber()
  originLng: number;

  @IsString()
  destName: string;

  @IsNumber()
  destLat: number;

  @IsNumber()
  destLng: number;

  @IsOptional()
  @IsArray()
  waypoints?: WaypointDto[];

  @IsOptional()
  @IsEnum(RouteType)
  routeType?: RouteType;

  @IsOptional()
  @IsNumber()
  distance?: number;

  @IsOptional()
  @IsNumber()
  duration?: number;

  @IsOptional()
  @IsString()
  polyline?: string;
}
