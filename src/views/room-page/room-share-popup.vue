<script setup lang="ts">
import { computed, ref, watch } from "vue"
import QRCode from "qrcode"
import PtButton from "../../components/pt-button.vue"
import cui from "../../components/custom-ui"
import ptApi from "../../utils/pt-api"

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  shareUrl: {
    type: String,
    default: "",
  },
  roomName: {
    type: String,
    default: "",
  },
  roomId: {
    type: String,
    default: "",
  },
  isPersistent: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(["close"])
const qrCodeUrl = ref("")
const qrCodeError = ref("")

const roomTitle = computed(() => {
  return props.roomName?.trim() || `一起听房间 ${props.roomId}`
})

const roomDesc = computed(() => {
  return props.isPersistent
    ? "常驻房间二维码长期有效，删除房间后失效。"
    : "临时房间二维码在房间未删除前可用。"
})

const nativeShareData = computed<ShareData>(() => ({
  title: `${roomTitle.value} 邀请你一起听`,
  text: roomDesc.value,
  url: props.shareUrl,
}))

const onTapMask = () => {
  emit("close")
}

const doNothing = (e: Event) => {
  e.stopPropagation()
}

const onCopyLink = async () => {
  const copied = await ptApi.copyToClipboard(props.shareUrl)
  cui.showModal({
    title: copied ? "已复制链接" : "复制失败",
    content: copied ? "房间链接已复制到剪贴板。" : "请手动复制房间链接。",
    showCancel: false,
  })
}

const onNativeShare = async () => {
  if(ptApi.canShare(nativeShareData.value)) {
    const shared = await ptApi.share(nativeShareData.value)
    if(shared) return
  }
  await onCopyLink()
}

watch(
  () => [props.show, props.shareUrl],
  async () => {
    qrCodeError.value = ""
    qrCodeUrl.value = ""
    if(!props.show || !props.shareUrl) return

    try {
      qrCodeUrl.value = await QRCode.toDataURL(props.shareUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 260,
        color: {
          dark: "#111111",
          light: "#ffffff",
        },
      })
    }
    catch(err) {
      console.log("生成房间二维码失败")
      console.log(err)
      console.log(" ")
      qrCodeError.value = "二维码生成失败，请复制链接分享。"
    }
  },
  { immediate: true }
)
</script>

<template>
  <div
    class="rsp-container"
    :class="{ 'rsp-container_show': props.show }"
    @click="onTapMask"
  >
    <div class="rsp-box" @click="doNothing">
      <div class="rsp-head">
        <div>
          <h2>分享房间</h2>
          <p>{{ roomDesc }}</p>
        </div>
        <button class="rsp-close" type="button" aria-label="关闭" @click="onTapMask">×</button>
      </div>

      <div class="rsp-qr">
        <img v-if="qrCodeUrl" :src="qrCodeUrl" alt="房间二维码" />
        <div v-else class="rsp-qr-placeholder">
          <span>{{ qrCodeError || '正在生成二维码...' }}</span>
        </div>
      </div>

      <div class="rsp-link">
        <span>{{ props.shareUrl }}</span>
      </div>

      <div class="rsp-actions">
        <pt-button text="复制链接" type="other" @click="onCopyLink"></pt-button>
        <pt-button text="分享房间" @click="onNativeShare"></pt-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rsp-container {
  width: 100vw;
  height: 100vh;
  z-index: 2300;
  position: fixed;
  display: flex;
  align-items: center;
  justify-content: center;
  top: 0;
  left: 0;
  transition: opacity 0.2s;
  opacity: 0;
  visibility: hidden;
  background-color: rgba(0,0,0,.75);
  box-sizing: border-box;
  padding: 18px;
}

.rsp-container_show {
  opacity: 1;
  visibility: visible;
}

.rsp-box {
  width: min(100%, 420px);
  max-height: calc(100vh - 36px);
  overflow: auto;
  padding: 22px;
  border-radius: 10px;
  box-sizing: border-box;
  background-color: var(--bg-color);
  color: var(--text-color);
}

.rsp-head {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: flex-start;
}

.rsp-head h2 {
  margin: 0;
  font-size: var(--head-font);
  line-height: 1.4;
}

.rsp-head p {
  margin: 8px 0 0;
  color: var(--desc-color);
  font-size: var(--mini-font);
  line-height: 1.6;
}

.rsp-close {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  background: var(--other-btn-bg);
  color: var(--other-btn-text);
  font-size: 24px;
  line-height: 34px;
}

.rsp-qr {
  width: 100%;
  display: flex;
  justify-content: center;
  margin-top: 22px;
}

.rsp-qr img,
.rsp-qr-placeholder {
  width: 260px;
  height: 260px;
  border-radius: 8px;
  background: #fff;
}

.rsp-qr img {
  display: block;
}

.rsp-qr-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 16px;
  color: #333;
  text-align: center;
  font-size: 14px;
  line-height: 1.6;
}

.rsp-link {
  margin-top: 18px;
  padding: 12px;
  border-radius: 8px;
  background: var(--card-color);
  color: var(--desc-color);
  font-size: 13px;
  line-height: 1.5;
  user-select: text;
  word-break: break-all;
}

.rsp-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}

@media screen and (max-width: 360px) {
  .rsp-box {
    padding: 18px;
  }

  .rsp-qr img,
  .rsp-qr-placeholder {
    width: 220px;
    height: 220px;
  }

  .rsp-actions {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
