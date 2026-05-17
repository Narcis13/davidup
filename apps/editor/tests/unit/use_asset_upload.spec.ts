// Unit tests for `useAssetUpload` — step 18b.
//
// The DOM-side bits (real <input type=file>, drop events, the toast UI) are
// covered by manual Chrome MCP verification. This file locks down the state
// machine: progress events update the job, a 2xx response with an `asset`
// resolves the job to `success`, a 4xx with `{error}` resolves to `error`,
// and an unsupported file is rejected without ever opening an XHR.
//
// We drive the composable's `xhrFactory` option with a fake XHR so the test
// doesn't touch the network and never depends on jsdom — the composable
// only uses a handful of properties on the request object.

import { test } from '@japa/runner'
import { __resetUploadsForTests, useAssetUpload } from '../../inertia/composables/useAssetUpload.js'

interface ProgressEventInit {
  loaded: number
  total: number
  lengthComputable?: boolean
}

class FakeXhrUpload {
  listeners: Record<string, ((event: ProgressEventInit) => void)[]> = {}
  addEventListener(type: string, handler: (event: ProgressEventInit) => void): void {
    ;(this.listeners[type] ??= []).push(handler)
  }
  dispatch(type: string, event: ProgressEventInit): void {
    for (const h of this.listeners[type] ?? []) h(event)
  }
}

class FakeXhr {
  status = 0
  response: unknown = null
  responseType = ''
  responseText = ''
  withCredentials = false
  upload = new FakeXhrUpload()
  sentBody: unknown = null
  listeners: Record<string, (() => void)[]> = {}
  opened: { method: string; url: string } | null = null
  aborted = false

  open(method: string, url: string): void {
    this.opened = { method, url }
  }
  addEventListener(type: string, handler: () => void): void {
    ;(this.listeners[type] ??= []).push(handler)
  }
  send(body: unknown): void {
    this.sentBody = body
  }
  abort(): void {
    this.aborted = true
    this.dispatch('abort')
  }
  dispatch(type: string): void {
    for (const h of this.listeners[type] ?? []) h()
  }
  finishWith(status: number, body: unknown): void {
    this.status = status
    this.response = body
    this.dispatch('load')
  }
}

function fakeFile(name: string, size = 100): File {
  // Real File so FormData.append doesn't reject the value as not-a-Blob.
  // `size` is computed from the content length, so we allocate a buffer of
  // exactly the requested size.
  const buf = new Uint8Array(size)
  return new File([buf], name, { type: 'application/octet-stream' })
}

test.group('useAssetUpload · uploadFiles', (group) => {
  group.each.setup(() => {
    __resetUploadsForTests()
    return () => __resetUploadsForTests()
  })

  test('happy path — progress events update progress and 201 resolves to success', ({ assert }) => {
    const api = useAssetUpload()
    const xhrs: FakeXhr[] = []
    const created = api.uploadFiles([fakeFile('logo.png', 4096)], {
      endpoint: '/api/assets',
      xhrFactory: () => {
        const x = new FakeXhr()
        xhrs.push(x)
        return x as unknown as XMLHttpRequest
      },
      successLingerMs: 0,
      errorLingerMs: 0,
    })
    assert.lengthOf(created, 1)
    assert.equal(created[0]!.status, 'uploading')
    assert.lengthOf(xhrs, 1)
    const xhr = xhrs[0]!
    assert.equal(xhr.opened?.method, 'POST')
    assert.equal(xhr.opened?.url, '/api/assets')

    // Mid-upload progress.
    xhr.upload.dispatch('progress', {
      loaded: 1024,
      total: 4096,
      lengthComputable: true,
    })
    assert.closeTo(api.jobs.value[0]!.progress, 0.25, 0.001)

    xhr.finishWith(201, {
      asset: {
        id: 'abc',
        name: 'logo.png',
        url: 'assets/abc.png',
        kind: 'image',
        mediaType: 'image/png',
        size: 4096,
        hash: 'sha256:abc',
        createdAt: '2024-01-01T00:00:00Z',
      },
    })
    assert.equal(api.jobs.value[0]!.status, 'success')
    assert.equal(api.jobs.value[0]!.asset?.id, 'abc')
    assert.equal(api.jobs.value[0]!.progress, 1)
  })

  test('error response — 4xx body surfaces the server code + message', ({ assert }) => {
    const api = useAssetUpload()
    const xhrs: FakeXhr[] = []
    api.uploadFiles([fakeFile('bad.png', 10)], {
      xhrFactory: () => {
        const x = new FakeXhr()
        xhrs.push(x)
        return x as unknown as XMLHttpRequest
      },
      successLingerMs: 0,
      errorLingerMs: 0,
    })
    xhrs[0]!.finishWith(415, {
      error: { code: 'E_UNSUPPORTED_TYPE', message: 'Type not allowed' },
    })
    assert.equal(api.jobs.value[0]!.status, 'error')
    assert.equal(api.jobs.value[0]!.error?.code, 'E_UNSUPPORTED_TYPE')
    assert.equal(api.jobs.value[0]!.error?.message, 'Type not allowed')
  })

  test('network error — XHR error event resolves to E_NETWORK', ({ assert }) => {
    const api = useAssetUpload()
    const xhrs: FakeXhr[] = []
    api.uploadFiles([fakeFile('logo.png', 10)], {
      xhrFactory: () => {
        const x = new FakeXhr()
        xhrs.push(x)
        return x as unknown as XMLHttpRequest
      },
      successLingerMs: 0,
      errorLingerMs: 0,
    })
    xhrs[0]!.dispatch('error')
    assert.equal(api.jobs.value[0]!.status, 'error')
    assert.equal(api.jobs.value[0]!.error?.code, 'E_NETWORK')
  })

  test('unsupported file extension never opens an XHR', ({ assert }) => {
    const api = useAssetUpload()
    let factoryCalls = 0
    api.uploadFiles([fakeFile('notes.txt', 10)], {
      xhrFactory: () => {
        factoryCalls++
        return new FakeXhr() as unknown as XMLHttpRequest
      },
      successLingerMs: 0,
      errorLingerMs: 0,
    })
    assert.equal(factoryCalls, 0)
    assert.equal(api.jobs.value[0]!.status, 'error')
    assert.equal(api.jobs.value[0]!.error?.code, 'E_UNSUPPORTED_TYPE')
  })

  test('dismissJob aborts an in-flight upload and removes the toast', ({ assert }) => {
    const api = useAssetUpload()
    const xhrs: FakeXhr[] = []
    const [job] = api.uploadFiles([fakeFile('logo.png', 4096)], {
      xhrFactory: () => {
        const x = new FakeXhr()
        xhrs.push(x)
        return x as unknown as XMLHttpRequest
      },
      successLingerMs: 0,
      errorLingerMs: 0,
    })
    api.dismissJob(job!.id)
    assert.isTrue(xhrs[0]!.aborted, 'in-flight XHR should be aborted')
    assert.lengthOf(api.jobs.value, 0)
  })

  test('multiple files — each gets its own job and XHR', ({ assert }) => {
    const api = useAssetUpload()
    const xhrs: FakeXhr[] = []
    api.uploadFiles([fakeFile('a.png'), fakeFile('b.mp4'), fakeFile('c.mp3')], {
      xhrFactory: () => {
        const x = new FakeXhr()
        xhrs.push(x)
        return x as unknown as XMLHttpRequest
      },
      successLingerMs: 0,
      errorLingerMs: 0,
    })
    assert.lengthOf(xhrs, 3)
    assert.lengthOf(api.jobs.value, 3)
    assert.equal(api.activeCount.value, 3)
    assert.isTrue(api.isUploading.value)
  })

  test('target=global appends a `target` field to the multipart body', ({ assert }) => {
    const api = useAssetUpload()
    const xhrs: FakeXhr[] = []
    api.uploadFiles([fakeFile('logo.png', 4096)], {
      target: 'global',
      xhrFactory: () => {
        const x = new FakeXhr()
        xhrs.push(x)
        return x as unknown as XMLHttpRequest
      },
      successLingerMs: 0,
      errorLingerMs: 0,
    })
    const form = xhrs[0]!.sentBody as FormData
    assert.instanceOf(form, FormData)
    assert.equal(form.get('target'), 'global')
    assert.exists(form.get('file'), 'file part should still be present')
  })

  test('omitting target leaves the body without a target field (server defaults to project)', ({
    assert,
  }) => {
    const api = useAssetUpload()
    const xhrs: FakeXhr[] = []
    api.uploadFiles([fakeFile('logo.png', 4096)], {
      xhrFactory: () => {
        const x = new FakeXhr()
        xhrs.push(x)
        return x as unknown as XMLHttpRequest
      },
      successLingerMs: 0,
      errorLingerMs: 0,
    })
    const form = xhrs[0]!.sentBody as FormData
    assert.instanceOf(form, FormData)
    assert.isNull(form.get('target'), 'no target field when caller did not opt in')
  })
})
