<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3'
import { computed } from 'vue'

const props = defineProps<{ error: any }>()

const message = computed<string>(() => {
  const raw = props.error?.message
  if (typeof raw === 'string' && raw.trim().length > 0) return raw
  return 'Something went wrong on the server.'
})
</script>

<template>
  <Head title="davidup — server error" />

  <div class="error-page">
    <div class="error-inner">
      <div class="error-brand">davidup</div>
      <div class="error-code" aria-hidden>500</div>
      <h1 class="error-title">Server error</h1>
      <p class="error-sub">
        An unexpected error occurred while processing your request.
      </p>
      <pre class="error-detail" data-testid="error-detail">{{ message }}</pre>
      <div class="error-actions">
        <Link href="/" class="btn btn-primary">Back to projects</Link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.error-page {
  min-height: 100vh;
  width: 100%;
  background: radial-gradient(1200px 600px at 50% -200px, rgba(91, 124, 250, 0.18), transparent 60%),
    #0a0a0a;
  color: #e5e5e5;
  font-family: 'Instrument Sans', system-ui, -apple-system, sans-serif;
  padding: 48px 20px 80px;
  box-sizing: border-box;
  display: grid;
  place-items: center;
}

.error-inner {
  max-width: 560px;
  width: 100%;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.error-brand {
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #5b7cfa;
  font-weight: 600;
  margin-bottom: 4px;
}

.error-code {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 88px;
  line-height: 1;
  font-weight: 600;
  letter-spacing: -0.04em;
  background: linear-gradient(180deg, #ffa3a3 0%, #ff6b6b 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  margin: 0;
}

.error-title {
  font-size: 28px;
  line-height: 1.1;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.02em;
}

.error-sub {
  font-size: 15px;
  color: #a3a3a3;
  margin: 0;
  line-height: 1.5;
}

.error-detail {
  width: 100%;
  box-sizing: border-box;
  margin: 6px 0 0;
  padding: 12px 14px;
  text-align: left;
  background: #0d0d0d;
  border: 1px solid rgba(255, 107, 107, 0.25);
  border-radius: 8px;
  color: #ffb3b3;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
}

.error-actions {
  margin-top: 10px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 10px 18px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: background 120ms ease, border-color 120ms ease;
}

.btn-primary {
  background: #5b7cfa;
  color: white;
}

.btn-primary:hover {
  background: #6e8cff;
}
</style>
