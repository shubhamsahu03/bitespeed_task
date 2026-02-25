import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { identify } from "../services/identity.service";

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------
const IdentifySchema = z
  .object({
    email: z
      .string()
      .trim()
      .email("Invalid email format")
      .nullable()
      .optional(),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^\+?[\d\s\-().]{1,20}$/, "Invalid phone number format")
      .nullable()
      .optional(),
  })
  .refine(
    (data) =>
      (data.email != null && data.email !== "") ||
      (data.phoneNumber != null && data.phoneNumber !== ""),
    { message: "At least one of email or phoneNumber must be provided" }
  );

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------
export async function identifyController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = IdentifySchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
      return;
    }

    const { email, phoneNumber } = parsed.data;

    const result = await identify({
      email: email ?? null,
      phoneNumber: phoneNumber ?? null,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
