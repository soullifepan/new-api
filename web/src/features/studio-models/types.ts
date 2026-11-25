/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
export type StudioModelStatus = 'published' | 'hidden'

export type StudioModel = {
  id: string
  name: string
  category: string
  thumbnail_url: string
  thumbnail_object_key: string
  model_url: string
  model_object_key: string
  format: string
  file_size: number
  sort: number
  status: StudioModelStatus
  created_at: string
  updated_at: string
}

export type StudioModelInput = Omit<
  StudioModel,
  'id' | 'created_at' | 'updated_at'
>

export type UploadedStudioAsset = {
  url: string
  objectKey: string
  assetType: '3d-model' | '3d-thumbnail'
}
