<script setup lang="ts">
import PtSwitch from '../../components/pt-switch.vue';
import PtButton from '../../components/pt-button.vue';
import { computed, ref, watch } from 'vue';
import type { PropType } from 'vue';
import type { PageParticipant } from '../../type/type-room-page';
import type { RoomPermissionConfig, RoomRole } from '../../type';

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  everyoneCanOperatePlayer: {
    type: String,
    default: "",
  },
  permissions: {
    type: Object as PropType<RoomPermissionConfig>,
    default: () => ({
      memberCanControlPlayback: true,
      memberCanManageQueue: true,
      memberCanImportPlaylist: true,
    }),
  },
  roomName: {
    type: String,
    default: "",
  },
  isPersistent: {
    type: Boolean,
    default: false,
  },
  amIOwner: {
    type: Boolean,
    default: false,
  },
  roomRole: {
    type: String as PropType<RoomRole>,
    default: "member",
  },
  participants: {
    type: Array as PropType<PageParticipant[]>,
    default: () => [],
  }
})
const emit = defineEmits(["tapmask", "everyoneCanOperatePlayerChange", "permissionChange", "transferOwner", "roomNameChange", "deleteRoom"])
const roomNameDraft = ref(props.roomName)
const transferGuestId = ref("")
watch(() => props.roomName, (val) => {
  roomNameDraft.value = val
})
watch(() => props.show, (val) => {
  if(val) transferGuestId.value = ""
})
const roleText = computed(() => props.roomRole === "owner" ? "房主" : "普通成员")
const transferCandidates = computed(() => {
  return props.participants.filter(item => !item.isMe)
})
const onTapMask = () => {
  emit("tapmask", { msg: "点了蒙层" })
}
const onEveryoneCanOperatePlayerChange = (opt: { checked: boolean }) => {
  emit("everyoneCanOperatePlayerChange", opt)
}
const onPermissionChange = (key: keyof RoomPermissionConfig, opt: { checked: boolean }) => {
  emit("permissionChange", key, opt)
}
const onSaveRoomName = () => {
  emit("roomNameChange", roomNameDraft.value)
}
const onDeleteRoom = () => {
  emit("deleteRoom")
}
const onTransferOwner = () => {
  if(!transferGuestId.value) return
  emit("transferOwner", transferGuestId.value)
}

const doNothing = (e: Event) => {
  e.stopPropagation()
}

</script>

<template>
  <div class="rmp-container" 
    :class="{ 'rmp-container_show': props.show }"
    @click="onTapMask"
  >
    <div class="rmp-box" @click="doNothing">
      <div class="rmp-first-bar">
        <div class="rmpf-title">管理</div>
      </div>
      <div class="rmp-role">
        <span>当前身份</span>
        <strong>{{ roleText }}</strong>
      </div>
      <div v-if="props.amIOwner" class="rmp-bar">
        <div class="rmpb-hd">
          <span>允许普通成员控制播放</span>
        </div>
        <div class="rmpb-footer">
          <pt-switch :checked="props.permissions.memberCanControlPlayback"
            @change="onEveryoneCanOperatePlayerChange"
          ></pt-switch>
        </div>
      </div>
      <div v-if="props.amIOwner" class="rmp-bar">
        <div class="rmpb-hd">
          <span>允许普通成员管理队列</span>
        </div>
        <div class="rmpb-footer">
          <pt-switch
            :checked="props.permissions.memberCanManageQueue"
            @change="(opt) => onPermissionChange('memberCanManageQueue', opt)"
          ></pt-switch>
        </div>
      </div>
      <div v-if="props.amIOwner" class="rmp-bar">
        <div class="rmpb-hd">
          <span>允许普通成员导入歌单</span>
        </div>
        <div class="rmpb-footer">
          <pt-switch
            :checked="props.permissions.memberCanImportPlaylist"
            @change="(opt) => onPermissionChange('memberCanImportPlaylist', opt)"
          ></pt-switch>
        </div>
      </div>
      <div v-if="props.isPersistent" class="rmp-room-name">
        <div class="rmpb-hd">
          <span>常驻房间名称</span>
        </div>
        <div class="rmp-room-name__body">
          <input v-model="roomNameDraft" maxlength="30" placeholder="输入房间名称" />
          <button v-if="props.amIOwner" @click="onSaveRoomName">保存</button>
        </div>
      </div>
      <div v-if="props.amIOwner && transferCandidates.length" class="rmp-transfer">
        <div class="rmpb-hd">
          <span>转让房主</span>
        </div>
        <div class="rmp-transfer__body">
          <select v-model="transferGuestId">
            <option value="">选择成员</option>
            <option
              v-for="item in transferCandidates"
              :key="item.guestId"
              :value="item.guestId"
            >{{ item.nickName }}</option>
          </select>
          <button :disabled="!transferGuestId" @click="onTransferOwner">转让</button>
        </div>
      </div>
      <div v-if="props.isPersistent && props.amIOwner" class="rmp-danger">
        <button @click="onDeleteRoom">删除常驻房间</button>
      </div>
      <div class="rmp-btn">
        <pt-button text="关闭" type="other" @click="onTapMask"></pt-button>
      </div>
    </div>
  </div>
</template>

<style scoped>

.rmp-container {
  width: 100vw;
  height: 100vh;
  z-index: 2200;
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
}

.rmp-container_show {
  opacity: 1;
  visibility: visible;
}

.rmp-box {
  width: 72%;
  max-width: 700px;
  padding: 20px 30px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-color);
  position: relative;
}

.rmp-first-bar {
  display: flex;
  flex: 1;
  position: relative;
  padding-top: 4px;
  padding-bottom: 10px;
}

.rmpf-title {
  font-size: var(--head-font);
  font-weight: 700;
  line-height: 50px;
  color: var(--text-color);
}

.rmp-bar {
  display: flex;
  flex: 1;
  position: relative;
  padding-bottom: 10px;
  justify-content: space-between;
}

.rmp-role {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0 16px;
  color: var(--text-color);
  font-size: var(--desc-font);
}

.rmp-role strong {
  color: var(--theme-a);
  font-size: var(--title-font);
}

.rmpb-hd {
  font-size: var(--title-font);
  color: var(--text-color);
  width: 70%;
  line-height: 32px;
  margin-right: 10px;
  padding-top: 4px;
}

.rmpb-footer {
  display: flex;
  height: 40px;
  align-items: center;
}

.rmp-btn {
  width: 40%;
  min-width: 140px;
  padding: 30px 0 6px;
  margin: auto;
}

.rmp-room-name {
  padding: 10px 0 12px;
}

.rmp-room-name__body,
.rmp-transfer__body {
  display: flex;
  gap: 10px;
  align-items: center;
}

.rmp-room-name__body input,
.rmp-transfer__body select {
  flex: 1;
  min-width: 0;
  height: 38px;
  border: 1px solid var(--card-color);
  border-radius: 6px;
  padding: 0 12px;
  box-sizing: border-box;
  background: var(--card-color);
  color: var(--text-color);
  font-size: var(--desc-font);
}

.rmp-room-name__body button,
.rmp-transfer__body button,
.rmp-danger button {
  border: 0;
  border-radius: 6px;
  height: 38px;
  padding: 0 14px;
  cursor: pointer;
  background: var(--other-btn-bg);
  color: var(--other-btn-text);
}

.rmp-transfer {
  padding: 10px 0 12px;
}

.rmp-transfer__body button:disabled {
  cursor: default;
  opacity: .5;
}

.rmp-danger {
  padding-top: 8px;
}

.rmp-danger button {
  background: #b3261e;
  color: #fff;
}

</style>
