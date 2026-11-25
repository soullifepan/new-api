/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { z } from 'zod'

export const modelFormSchema = z.object({
  name: z.string().trim().min(1).max(128),
  category: z.string().trim().min(1).max(32),
  thumbnail_url: z.string().url(),
  thumbnail_object_key: z.string().min(1),
  model_url: z.string().url(),
  model_object_key: z.string().min(1),
  format: z.enum(['glb', 'gltf', 'fbx', 'obj']),
  file_size: z.number().int().positive(),
  sort: z.number().int(),
  status: z.enum(['published', 'hidden']),
})

export type ModelFormValues = z.infer<typeof modelFormSchema>
