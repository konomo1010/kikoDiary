<script setup>
import { ref, watch, nextTick } from 'vue'
import { modal, closeModal, cancelModal, secondaryModal, confirmModal } from '../store'

const inputEl = ref(null)

watch(() => modal.open, (open) => {
  if (open && modal.input) {
    nextTick(() => { if (inputEl.value) inputEl.value.focus() })
  }
})

function onKeydown(e) {
  if (e.key === 'Enter') confirmModal()
}
</script>

<template>
  <div v-if="modal.open" class="modal-overlay" @click.self="closeModal">
    <div class="modal">
      <h3>{{ modal.title }}</h3>
      <p v-if="modal.body" class="modal-body">{{ modal.body }}</p>
      <ul v-if="modal.list.length" class="modal-list">
        <li v-for="(item, i) in modal.list" :key="i">{{ item }}</li>
        <li v-if="modal.listMore > 0" class="modal-list-more">…以及另外 {{ modal.listMore }} 个</li>
      </ul>
      <input
        v-if="modal.input"
        ref="inputEl"
        v-model="modal.inputValue"
        type="text"
        :placeholder="modal.inputPlaceholder"
        maxlength="20"
        @keydown="onKeydown"
      >
      <div class="modal-actions">
        <button class="btn btn-ghost" @click="cancelModal">取消</button>
        <button v-if="modal.secondaryText" class="btn btn-ghost" @click="secondaryModal">
          {{ modal.secondaryText }}
        </button>
        <button
          class="btn"
          :class="modal.danger ? 'btn-danger' : 'btn-primary'"
          @click="confirmModal"
        >{{ modal.confirmText }}</button>
      </div>
    </div>
  </div>
</template>