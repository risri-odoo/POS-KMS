import { registerDecorator, type ValidationArguments, type ValidationOptions } from 'class-validator';
import { Decimal } from 'decimal.js';

/**
 * Validates a monetary amount supplied as a decimal STRING (amounts are stored
 * as numeric(12,2) and handled as strings to avoid float drift). Mirrors HAIP's
 * IsMoneyString, but also caps the value at 2 decimal places so Postgres never
 * silently rounds on insert. Zero and negatives are rejected.
 */
export function IsMoneyString(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMoneyString',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/.test(value)) return false;
          return new Decimal(value).greaterThan(0);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a positive decimal string with at most 2 decimal places`;
        },
      },
    });
  };
}
