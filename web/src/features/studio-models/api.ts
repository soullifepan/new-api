/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { api, type ApiRequestConfig } from '@/lib/api'

import type {
  StudioModel,
  StudioModelInput,
  UploadedStudioAsset,
} from './types'

const mutationConfig: ApiRequestConfig = {
  skipBusinessError: true,
  skipErrorHandler: true,
}

export async function listStudioModels(): Promise<StudioModel[]> {
  const response = await api.get<{ data: StudioModel[] }>(
    '/api/studio/v1/admin/models'
  )
  return response.data.data ?? []
}

export async function createStudioModel(input: StudioModelInput) {
  const response = await api.post<StudioModel>(
    '/api/studio/v1/admin/models',
    input,
    mutationConfig
  )
  return response.data
}

export async function updateStudioModel(
  id: string,
  input: StudioModelInput
) {
  const response = await api.put<StudioModel>(
    `/api/studio/v1/admin/models/${encodeURIComponent(id)}`,
    input,
    mutationConfig
  )
  return response.data
}

export async function deleteStudioModel(id: string) {
  await api.delete(
    `/api/studio/v1/admin/models/${encodeURIComponent(id)}`,
    mutationConfig
  )
}

export async function uploadStudioAsset(
  file: File,
  assetType: UploadedStudioAsset['assetType']
): Promise<UploadedStudioAsset> {
  const form = new FormData()
  form.append('file', file)
  form.append('assetType', assetType)
  const response = await api.post<UploadedStudioAsset>(
    '/api/studio/v1/admin/assets',
    form,
    mutationConfig
  )
  return response.data
}
