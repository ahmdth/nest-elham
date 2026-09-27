import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, IsUUID } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateBookingDto {
  @IsUUID('4', { message: 'slotId must be a valid UUID.' })
  slotId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'customerName must not be empty.' })
  customerName!: string;

  @Transform(trim)
  @IsEmail({}, { message: 'customerEmail must be a valid email address.' })
  customerEmail!: string;
}
