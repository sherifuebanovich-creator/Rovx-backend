import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  code: string;

  // Was MinLength(6) — weaker than RegisterDto's MinLength(8), so a direct
  // API call (bypassing the frontend's 8-char enforcement, which was only
  // ever cosmetic) could set a password shorter than the site's own stated
  // minimum for every account that ever goes through password reset.
  @ApiProperty({ example: 'newPassword123', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}
