export class InputError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "InputError";
  }
}

export function isInputError(error: unknown): error is InputError {
  return error instanceof InputError;
}
