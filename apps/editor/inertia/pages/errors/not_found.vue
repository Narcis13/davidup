<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3'
</script>

<template>
  <Head title="davidup — page not found" />

  <div class="error-page">
    <div class="error-inner">
      <div class="error-brand">davidup</div>
      <div class="error-code" aria-hidden>404</div>
      <h1 class="error-title">Page not found</h1>
      <p class="error-sub">
        The page you're looking for doesn't exist or has been moved.
      </p>
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
  max-width: 480px;
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
  background: linear-gradient(180deg, #97aaff 0%, #5b7cfa 100%);
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
