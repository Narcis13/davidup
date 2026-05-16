<script setup lang="ts">
// LibraryCard — step 13 of the editor build plan.
//
// One card per library catalog entry. Shows a 1-second preview thumbnail
// (lazy-loaded from `/api/library/thumbnail`), the item name, and its
// provenance (kind + source file). The thumbnail request goes through the
// existing `render_preview_frame` path on the server; when synthesis
// isn't viable the server returns a styled placeholder PNG and tags the
// response with `X-Thumbnail-Placeholder: 1` — we surface that as a small
// kind badge over the image.
//
// IntersectionObserver gates the fetch so cards below the fold don't
// trigger renders until they scroll into view.

import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { LibraryItem } from '~/composables/useLibrary'

const props = defineProps<{
  item: LibraryItem
  /** Cache-buster bumped when the catalog reloads. */
  generation?: number
}>()

const root = ref<HTMLElement | null>(null)
const inView = ref(false)
const loaded = ref(false)
const errored = ref(false)

let observer: IntersectionObserver | null = null

onMounted(() => {
  if (!root.value) return
  if (typeof IntersectionObserver === 'undefined') {
    // SSR / test fallback — load immediately.
    inView.value = true
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          inView.value = true
          if (observer && entry.target instanceof Element) observer.unobserve(entry.target)
        }
      }
    },
    { rootMargin: '80px' }
  )
  observer.observe(root.value)
})

onBeforeUnmount(() => {
  if (observer) observer.disconnect()
  observer = null
})

const thumbnailSrc = computed(() => {
  if (!inView.value) return null
  const params = new URLSearchParams({ kind: props.item.kind, id: props.item.id })
  if (props.generation) params.set('v', String(props.generation))
  return `/api/library/thumbnail?${params.toString()}`
})

const provenance = computed(() => {
  if (props.item.source && props.item.source !== 'index.json') return props.item.source
  return 'inline'
})

const displayName = computed(() => props.item.name ?? props.item.id)
const subtitle = computed(() => {
  if (props.item.description) return props.item.description
  return props.item.id
})

const kindLabel = computed(() => props.item.kind)
</script>

<template>
  <article
    ref="root"
    class="library-card"
    :data-kind="item.kind"
    :data-item-id="item.id"
    tabindex="0"
  >
    <div class="thumb-wrap">
      <img
        v-if="thumbnailSrc && !errored"
        :src="thumbnailSrc"
        :alt="`${item.kind} preview · ${displayName}`"
        class="thumb"
        loading="lazy"
        decoding="async"
        @load="loaded = true"
        @error="errored = true"
      />
      <div v-else-if="!inView" class="thumb thumb-pending" aria-hidden="true" />
      <div v-else class="thumb thumb-error" aria-hidden="true">
        <span class="thumb-error-text">no preview</span>
      </div>

      <div v-if="!loaded && !errored && inView" class="thumb-shimmer" aria-hidden="true" />

      <span class="kind-badge" :data-kind="item.kind">{{ kindLabel }}</span>
    </div>
    <div class="meta">
      <h3 class="name" :title="displayName">{{ displayName }}</h3>
      <p class="sub" :title="subtitle">{{ subtitle }}</p>
      <p class="prov" :title="provenance">
        <span class="prov-dot" />
        {{ provenance }}
      </p>
    </div>
  </article>
</template>

<style scoped>
.library-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  cursor: grab;
  outline: none;
  transition: border-color 120ms ease, transform 120ms ease;
}

.library-card:hover {
  border-color: rgba(91, 124, 250, 0.45);
}

.library-card:focus-visible {
  border-color: rgba(91, 124, 250, 0.65);
  box-shadow: 0 0 0 2px rgba(91, 124, 250, 0.25);
}

.thumb-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #050505;
  overflow: hidden;
}

.thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #050505;
}

.thumb-pending,
.thumb-error {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #050505;
  color: #404040;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.thumb-error-text {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.thumb-shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.04) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  animation: shimmer 1.2s linear infinite;
  pointer-events: none;
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

.kind-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.55);
  color: #e5e5e5;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  pointer-events: none;
}

.kind-badge[data-kind='template'] {
  color: #ffb86b;
}
.kind-badge[data-kind='behavior'] {
  color: #6bd06b;
}
.kind-badge[data-kind='scene'] {
  color: #ffd66b;
}
.kind-badge[data-kind='asset'] {
  color: #8aa8ff;
}
.kind-badge[data-kind='font'] {
  color: #cf8aff;
}

.meta {
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.name {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  color: #e5e5e5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sub {
  font-size: 11px;
  color: #909090;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prov {
  font-size: 10px;
  color: #707070;
  margin: 2px 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prov-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  flex: 0 0 auto;
}
</style>
