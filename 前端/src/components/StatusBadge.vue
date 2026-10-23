<script setup>
import { tone } from '../data.js'
defineProps({ status: { type: String, default: '数据缺失' } })
</script>
<template><span class="badge" :class="tone(status)">{{ status }}</span></template>
