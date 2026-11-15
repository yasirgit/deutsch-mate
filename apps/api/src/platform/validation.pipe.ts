import { BadRequestException, ValidationPipe } from "@nestjs/common";

/** Global ValidationPipe: unknown properties fail (docs/API.md). */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: false,
    validateCustomDecorators: true,
    exceptionFactory: (errors) => {
      const fieldErrors = errors.flatMap((error) => {
        const constraints = error.constraints ?? {};
        return Object.entries(constraints).map(([code, message]) => ({
          path: `/${error.property}`,
          code,
          message,
        }));
      });
      return new BadRequestException({
        code: "validation_failed",
        detail: "One or more fields are invalid.",
        errors: fieldErrors,
      });
    },
  });
}
