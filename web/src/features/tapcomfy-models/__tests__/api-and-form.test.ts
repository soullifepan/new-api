/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
    put: mocks.put,
    delete: mocks.remove,
  },
}))

import { listTapComfyModels, uploadTapComfyAsset } from '../api'
import { modelFormSchema } from '../form-schema'

describe('TapComfy model form', () => {
  it('rejects a model whose uploaded asset references are missing', () => {
    const result = modelFormSchema.safeParse({
      name: 'Chair',
      category: 'furniture',
      format: 'glb',
      file_size: 1,
      sort: 0,
      status: 'published',
      thumbnail_url: '',
      thumbnail_object_key: '',
      model_url: '',
      model_object_key: '',
    })

    expect(result.success).toBe(false)
  })
})

describe('TapComfy model API', () => {
  it('maps the admin catalogue and multipart upload endpoints', async () => {
    mocks.get.mockResolvedValueOnce({ data: { data: [{ id: 'chair' }] } })
    mocks.post.mockResolvedValueOnce({
      data: {
        url: 'https://example.test/model.glb',
        objectKey: '3d_models/models/model.glb',
        assetType: '3d-model',
      },
    })

    await expect(listTapComfyModels()).resolves.toEqual([{ id: 'chair' }])
    await uploadTapComfyAsset(new File(['glTF'], 'model.glb'), '3d-model')

    expect(mocks.get).toHaveBeenCalledWith('/api/tapcomfy/v1/admin/models')
    expect(mocks.post.mock.calls[0][0]).toBe('/api/tapcomfy/v1/admin/assets')
    expect(mocks.post.mock.calls[0][1]).toBeInstanceOf(FormData)
  })
})
