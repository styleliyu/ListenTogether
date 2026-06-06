<script setup lang="ts">
import 'shikwasa2/dist/shikwasa.min.css'
import PtButton from "../../components/pt-button.vue"
import { useRoomPage } from "./tools/useRoomPage"
import ListeningLoader from '../../components/listening-loader.vue'
import images from '../../images';
import { initBtns } from "./tools/handle-btns"
import { computed, ref, toRef, watch } from 'vue';
import { useTheme } from '../../hooks/useTheme';
import { initManage } from './tools/init-manage';
import RoomManagePopup from './room-manage-popup.vue';
import { useCccee } from "./tools/cccee"

const { theme } = useTheme()
const { 
  pageData, 
  playerEl, 
  toHome, 
  toContact, 
  toEditMyName, 
  onEveryoneCanOperatePlayerChange,
  onRoomPermissionChange,
  onTransferOwner,
  onQueueItemTap,
  onQueueAdvance,
  onQueueRemoveItem,
  onQueueSkipCurrent,
  onQueuePlayNext,
  onPlayModeChange,
  onAppendQueueByLink,
  onCancelPlaylistImport,
  onTogglePlaylistImportPanel,
  onRoomNameChange,
  onDeleteRoom,
} = useRoomPage()
const state = toRef(pageData, "state")
const { 
  btnText, 
  btnText2, 
  h1, 
  pText, 
  onTapBtn, 
  onTapBtn2,
  onTapLeave,
  onTapShare,
  onTapEditMyName,
} = initBtns(state, pageData, toHome, toContact, toEditMyName)
const { 
  showManagePopup,
  onTapManageBtn,
  onTapManageMask,
} = initManage()

useCccee(pageData)

const alwaysFalse = ref(false)
const showPlaylistImportFailureDetails = ref(false)
const hasLink = computed(() => {
  const linkUrl = pageData.content?.linkUrl
  if(linkUrl) return true
  return false
})

const playModeText = computed(() => {
  const mode = pageData.queue?.playMode
  if(mode === "shuffle") return "随机"
  if(mode === "single") return "单曲循环"
  return "顺序"
})

const roomDisplayName = computed(() => {
  return pageData.roomName?.trim() || `一起听房间 ${pageData.roomId}`
})

const playlistImportStatusText = computed(() => {
  const status = pageData.playlistImportProgress?.status
  if(status === "completed") return "已完成"
  if(status === "cancelled") return "已取消"
  if(status === "failed") return "导入失败"
  return "正在导入"
})

const playlistImportSummary = computed(() => {
  const progress = pageData.playlistImportProgress
  if(!progress) return pageData.playlistImportMessage || ""
  if(progress.status === "completed") {
    return `导入完成：成功 ${progress.addedCount || 0} 首，失败 ${progress.failedCount || 0} 首`
  }
  if(progress.status === "cancelled") {
    return `已取消：已加入 ${progress.addedCount || 0} 首，失败 ${progress.failedCount || 0} 首`
  }
  if(progress.status === "failed") {
    return `导入失败：已加入 ${progress.addedCount || 0} 首，失败 ${progress.failedCount || 0} 首`
  }
  return `导入中：已加入 ${progress.addedCount || 0} 首，已解析 ${progress.parsedCount || 0}/${progress.total || 0}，失败 ${progress.failedCount || 0} 首`
})

const showPlaylistImportPanel = computed(() => {
  return Boolean(pageData.playlistImportProgress || pageData.playlistImportMessage)
})

const canCancelPlaylistImport = computed(() => {
  const status = pageData.playlistImportProgress?.status
  return status === "started" || status === "progress"
})

const canControlPlayback = computed(() => {
  return pageData.amIOwner || pageData.permissions.memberCanControlPlayback
})

const canManageQueue = computed(() => {
  return pageData.amIOwner || pageData.permissions.memberCanManageQueue
})

const canImportPlaylist = computed(() => {
  return pageData.amIOwner || pageData.permissions.memberCanImportPlaylist
})

const canAppendQueueByLink = computed(() => {
  return canManageQueue.value || canImportPlaylist.value
})

const showPlaylistImportDetails = computed(() => {
  return showPlaylistImportPanel.value && !pageData.playlistImportCollapsed
})

const playlistImportFailedTracks = computed(() => {
  return pageData.playlistImportProgress?.failedTracks || []
})

const showPlaylistImportFailureEntry = computed(() => {
  const progress = pageData.playlistImportProgress
  return Boolean((progress?.failedCount || 0) > 0 && playlistImportFailedTracks.value.length > 0)
})

const visiblePlaylistImportFailedTracks = computed(() => {
  return playlistImportFailedTracks.value.slice(0, 10)
})

const hiddenPlaylistImportFailedTrackCount = computed(() => {
  const progress = pageData.playlistImportProgress
  const total = progress?.failedCount || playlistImportFailedTracks.value.length
  return Math.max(total - visiblePlaylistImportFailedTracks.value.length, 0)
})

const onTogglePlaylistImportFailureDetails = () => {
  showPlaylistImportFailureDetails.value = !showPlaylistImportFailureDetails.value
}

watch(
  () => pageData.playlistImportProgress?.status,
  status => {
    if(status === "started") showPlaylistImportFailureDetails.value = false
  }
)

const queueCurrentNumber = computed(() => {
  if(!pageData.queue?.items?.length) return 0
  return Math.min((pageData.queue.currentIndex || 0) + 1, pageData.queue.items.length)
})

const queueTotalCount = computed(() => {
  return pageData.queue?.items?.length || 0
})

const isQueueItemCurrent = (index: number, itemId: string) => {
  if(pageData.queue?.currentItemId) return pageData.queue.currentItemId === itemId
  return index === pageData.queue?.currentIndex
}

const onTapShowMore = () => {
  if(hasLink.value) {
    window.open(pageData.content?.linkUrl as string, "_blank")
    return
  }
  if(pageData.showMoreBox) pageData.showMoreBox = false
}

</script>

<template>
  <div class="page">

    <!-- 给浏览器爬 -->
    <div v-show="alwaysFalse">
      <img :src="images.APP_LOGO_COS" height="132" width="132" />
      <p>{{ pageData.content?.title ? pageData.content.title 
        : pageData.content?.seriesName ? '邀请你一起听《' + pageData.content?.seriesName + '》' 
        : '邀请你一起听！' }}</p>
    </div>


    <!-- 加载中 -->
    <div v-if="state <= 2" class="page-full">
      <ListeningLoader />
      <div class="pf-text">
        <span v-if="state === 1">正在进入房间..</span>
        <span v-else>正在连接播放器..</span>
      </div>
    </div>

    <!-- 正常显示 -->
    <div v-show="state === 3" class="page-container">

      <div class="room-header">
        <h1>{{ roomDisplayName }}</h1>
      </div>

      <!-- 播放器 -->
      <div ref="playerEl" class="rp-player"></div>

      <div v-if="pageData.queue?.items?.length" class="room-queue">
        <div class="queue-head">
          <div>
            <h2>播放队列</h2>
            <p>{{ queueCurrentNumber }} / {{ queueTotalCount }}</p>
          </div>
          <div class="queue-actions">
            <button :disabled="!canAppendQueueByLink" @click="onAppendQueueByLink">添加歌曲/歌单</button>
            <button :disabled="!canControlPlayback" @click="onQueueAdvance('prev')">上一首</button>
            <button :disabled="!canControlPlayback" @click="onQueueAdvance('next')">下一首</button>
            <button :disabled="!canControlPlayback" @click="onPlayModeChange">{{ playModeText }}</button>
          </div>
        </div>
        <div v-if="showPlaylistImportPanel" class="playlist-import-panel">
          <div class="playlist-import-panel__head">
            <button class="playlist-import-panel__toggle" @click="onTogglePlaylistImportPanel">
              {{ pageData.playlistImportCollapsed ? '展开' : '收起' }}
            </button>
            <div class="playlist-import-panel__summary">
              <h3>歌单导入</h3>
              <p>{{ playlistImportSummary }}</p>
            </div>
            <button
              v-if="canCancelPlaylistImport"
              class="playlist-import-panel__cancel"
              :disabled="pageData.cancellingPlaylistImport"
              @click="onCancelPlaylistImport"
            >{{ pageData.cancellingPlaylistImport ? '取消中...' : '取消导入' }}</button>
          </div>
          <div v-if="showPlaylistImportDetails" class="playlist-import-panel__grid">
            <span>状态：{{ playlistImportStatusText }}</span>
            <span>已加入：{{ pageData.playlistImportProgress?.addedCount || 0 }} 首</span>
            <span>已解析：{{ pageData.playlistImportProgress?.parsedCount || 0 }} / {{ pageData.playlistImportProgress?.total || 0 }}</span>
            <span>失败：{{ pageData.playlistImportProgress?.failedCount || 0 }} 首</span>
          </div>
          <div v-if="showPlaylistImportDetails && showPlaylistImportFailureEntry" class="playlist-import-panel__failures">
            <button class="playlist-import-panel__failure-toggle" @click="onTogglePlaylistImportFailureDetails">
              {{ showPlaylistImportFailureDetails ? '收起失败详情' : '查看失败详情' }}
            </button>
            <div v-if="showPlaylistImportFailureDetails" class="playlist-import-panel__failure-list">
              <div
                v-for="(item, index) in visiblePlaylistImportFailedTracks"
                :key="`${item.source || item.title || 'failed'}-${index}`"
                class="playlist-import-panel__failure-item"
              >
                <div class="playlist-import-panel__failure-main">
                  {{ item.title || item.source || '未知歌曲' }}
                </div>
                <div v-if="item.artist || item.source" class="playlist-import-panel__failure-sub">
                  {{ item.artist || item.source }}
                </div>
                <div class="playlist-import-panel__failure-reason">
                  {{ item.reason || '未知错误' }}
                </div>
              </div>
              <div v-if="hiddenPlaylistImportFailedTrackCount > 0" class="playlist-import-panel__failure-more">
                还有 {{ hiddenPlaylistImportFailedTrackCount }} 条失败未展示。
              </div>
            </div>
          </div>
        </div>
        <div class="queue-list">
          <div
            v-for="(item, index) in pageData.queue.items"
            :key="item.id + '-' + index"
            class="queue-item"
            :class="{ 'queue-item_active': isQueueItemCurrent(index, item.id) }"
          >
            <button class="queue-item__main" :disabled="!canControlPlayback" @click="onQueueItemTap(index)">
              <span class="queue-index">{{ index + 1 }}</span>
              <span class="queue-title">{{ item.title }}</span>
              <span class="queue-artist">{{ item.artist }}</span>
            </button>
            <div class="queue-item__actions">
              <span v-if="isQueueItemCurrent(index, item.id)" class="queue-item__badge">当前播放</span>
              <button
                v-if="isQueueItemCurrent(index, item.id)"
                class="queue-item__mini"
                :disabled="!canManageQueue"
                @click.stop="onQueueSkipCurrent"
              >跳过</button>
              <button
                v-else
                class="queue-item__mini"
                :disabled="!canManageQueue"
                @click.stop="onQueuePlayNext(item)"
              >下首播放</button>
              <button class="queue-item__mini queue-item__mini_danger" :disabled="!canManageQueue" @click.stop="onQueueRemoveItem(item)">删除</button>
            </div>
          </div>
        </div>
      </div>

      <div class="room-virtual-one"></div>

      <div v-if="pageData.participants?.length" class="room-listening">
        <div class="rl-title">正在听的有</div>
        <div class="rl-mini-btn" @click="onTapManageBtn">
          <span>管理</span>
        </div>
      </div>
      <div v-if="pageData.participants?.length"
        class="room-participants"
      >
        <template v-for="(item, index) in pageData.participants" :key="item.guestId">
          <div class="room-participant">
            <div class="rp-nickName" 
              :class="{ 'rp-nickName_pointer': item.isMe }" 
              @click="onTapEditMyName(item)"
            >
              <span>{{ item.nickName }}</span>
              <div v-if="item.isMe" class="div-bg-img rp-nickName-icon"></div>
            </div>
            <div class="rp-enter-time">
              <span>{{ item.enterStr }}进入</span>
            </div>
          </div>
        </template>
      </div>
      <div class="room-btns">
        <div class="room-btn" @click="onTapLeave">
          <div class="div-bg-img room-btn-icon room-btn-icon_leave"></div>
          <span>离开</span>
        </div>
        <div class="room-btn room-btn-main" @click="onTapShare">
          <div class="div-bg-img room-btn-icon room-btn-icon_share"></div>
          <span>分享</span>
        </div>
      </div>

      <div v-if="pageData.content?.title && pageData.content?.description"
        class="room-title-desc"
      >
        <div class="room-podcast-title">
          <span>{{ pageData.content.title }}</span>
        </div>
        <div class="room-desc-box">
          <div v-if="pageData.showMoreBox" 
            class="room-description room-desc-limited"
          >
            <span>{{ pageData.content.description }}</span>
          </div>
          <div v-else class="room-description" :class="{ 'room-desc_pointer': hasLink }" @click="onTapShowMore">
            <span>{{ pageData.content.description }}</span>
          </div>

          <!-- 展开更多 -->
          <div v-if="pageData.showMoreBox" 
            class="room-show-more"
            @click="onTapShowMore"
          >
            <span class="room-show-more-text">{{ hasLink ? '查看原文' : '展开更多' }}</span>
            <div class="div-bg-img room-show-more-icon" :class="{ 'rsmi-rotated': hasLink }" ></div>
            <div class="room-show-more-bg"></div>
          </div>
        </div>
      </div>

      <div class="room-virtual-two"></div>

    </div>

    <!-- 出现异常 -->
    <div v-show="state >= 11" class="page-full">
      <img :src="state === 17 ? images.IMG_DOOR : images.IMG_PLACEHOLDER" class="pf-no-data-img" />
      <div class="pf-no-data-box">
        <h1>{{ h1 }}</h1>
        <p v-if="pText">{{ pText }}</p>
      </div>
      <div class="pf-no-data-btns">
        <pt-button
          :type="btnText2 ? 'main' : 'other'"
          @click="onTapBtn"
          :text="btnText" 
        />
        <pt-button
          v-if="btnText2"
          type="other"
          class="pf-ndb-other"
          @click="onTapBtn2"
          :text="btnText2" 
        />
      </div>
    </div>

  </div>
  <RoomManagePopup 
    :show="showManagePopup" 
    :everyoneCanOperatePlayer="pageData.everyoneCanOperatePlayer"
    :permissions="pageData.permissions"
    :roomName="pageData.roomName || ''"
    :isPersistent="Boolean(pageData.isPersistent)"
    :amIOwner="pageData.amIOwner"
    :roomRole="pageData.roomRole"
    :participants="pageData.participants"
    @tapmask="onTapManageMask"
    @everyoneCanOperatePlayerChange="onEveryoneCanOperatePlayerChange"
    @permissionChange="onRoomPermissionChange"
    @transferOwner="onTransferOwner"
    @roomNameChange="onRoomNameChange"
    @deleteRoom="onDeleteRoom"
  ></RoomManagePopup>
  
</template>

<style scoped lang="scss">

.page {
  min-height: 100vh;
}

.page-full {
  height: 100vh;
  min-height: 480px;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  justify-content: space-evenly;
  align-items: center;
  width: 92%;
  max-width: 400px;
  position: relative;

  .pf-text {
    font-size: var(--desc-font);
    color: var(--desc-color);
    line-height: 1.5;
  }

  .pfnd-btns {
    width: 100%;
    height: 116px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .pf-no-data-img {
    width: 90px;
    height: 90px;
  }

  .pf-no-data-box {
    width: 100%;
    height: 150px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    h1 {
      margin-block-start: auto;
      margin-block-end: auto;
      font-size: var(--big-word-style);
      color: var(--text-color);
      line-height: 1.2;
    }

    p {
      margin-block-start: 20px;
      margin-block-end: auto;
      font-size: var(--desc-color);
      color: var(--desc-color);
      line-height: 1.5;
      text-align: center;
      white-space: pre-wrap;
      user-select: text;
    }
  }

  .pf-no-data-btns {
    width: 100%;
    height: 130px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    .pf-ndb-other {
      margin-top: 15px;
    }
  }

}

.page-container {
  padding-top: 50px;
  align-items: flex-start;
  text-align: left;
  max-width: 700px;

  .room-header {
    width: 100%;
    margin-bottom: 18px;

    h1 {
      margin: 0;
      color: var(--text-color);
      font-size: 24px;
      line-height: 34px;
      word-break: break-word;
    }
  }
  
  .rp-player {
    width: 100%;
    position: relative;
    z-index: 500;
  }

  .room-virtual-one {
    width: 100%;
    height: 50px;
  }

  .room-queue {
    width: 100%;
    margin-top: 24px;
    border-top: 1px solid var(--card-color);
    border-bottom: 1px solid var(--card-color);
    padding: 18px 0;
  }

  .queue-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: center;

    h2 {
      margin: 0;
      font-size: 20px;
      line-height: 28px;
    }

    p {
      margin: 4px 0 0;
      color: var(--note-color);
      font-size: 13px;
    }

    .queue-import-message {
      color: var(--desc-color);
    }
  }

  .queue-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;

    button {
      border: 0;
      border-radius: 6px;
      background: var(--other-btn-bg);
      color: var(--other-btn-text);
      height: 32px;
      padding: 0 12px;
      cursor: pointer;
      font-size: 13px;

      &:disabled {
        cursor: default;
        opacity: .48;
      }
    }
  }

  .playlist-import-panel {
    margin-top: 14px;
    padding: 14px;
    border-radius: 8px;
    background: var(--card-color);

    h3 {
      margin: 0;
      color: var(--text-color);
      font-size: 15px;
      line-height: 22px;
    }

    p {
      margin: 3px 0 0;
      color: var(--desc-color);
      font-size: 13px;
      line-height: 20px;
    }

    button {
      border: 0;
      border-radius: 6px;
      background: var(--other-btn-bg);
      color: var(--other-btn-text);
      height: 32px;
      padding: 0 12px;
      cursor: pointer;
      font-size: 13px;

      &:disabled {
        cursor: default;
        opacity: .6;
      }
    }
  }

  .playlist-import-panel__head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
  }

  .playlist-import-panel__summary {
    flex: 1;
    min-width: 0;
  }

  .playlist-import-panel__toggle {
    flex: 0 0 auto;
  }

  .playlist-import-panel__cancel {
    flex: 0 0 auto;
  }

  .playlist-import-panel__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 12px;
    margin-top: 12px;
    color: var(--note-color);
    font-size: 13px;
    line-height: 20px;
  }

  .playlist-import-panel__failures {
    margin-top: 12px;
  }

  .playlist-import-panel__failure-toggle {
    margin-top: 2px;
  }

  .playlist-import-panel__failure-list {
    margin-top: 10px;
    max-height: 260px;
    overflow: auto;
  }

  .playlist-import-panel__failure-item {
    padding: 10px 0;
    border-top: 1px solid rgba(127, 127, 127, .18);
  }

  .playlist-import-panel__failure-main {
    color: var(--text-color);
    font-size: 13px;
    line-height: 20px;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .playlist-import-panel__failure-sub,
  .playlist-import-panel__failure-reason,
  .playlist-import-panel__failure-more {
    margin-top: 3px;
    color: var(--note-color);
    font-size: 12px;
    line-height: 18px;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .playlist-import-panel__failure-reason {
    color: var(--desc-color);
  }

  .queue-list {
    margin-top: 14px;
    max-height: 320px;
    overflow: auto;
  }

  .queue-item {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    border-radius: 6px;
    background: transparent;
    color: var(--desc-color);
    text-align: left;
    padding: 4px 8px;
    font-size: 14px;

    &:hover {
      background: var(--card-color);
    }
  }

  .queue-item__main {
    min-width: 0;
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) minmax(0, 140px);
    gap: 12px;
    align-items: center;
    min-height: 38px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    padding: 0;
    font-size: 14px;
    outline: none;

    &:focus-visible {
      box-shadow: inset 0 0 0 2px var(--text-color);
    }

    &:disabled {
      cursor: default;
      opacity: .55;
    }
  }

  .queue-item__actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }

  .queue-item__badge {
    color: var(--note-color);
    font-size: 12px;
    white-space: nowrap;
  }

  .queue-item__mini {
    flex: 0 0 auto;
    border: 0;
    border-radius: 6px;
    background: var(--other-btn-bg);
    color: var(--other-btn-text);
    min-height: 28px;
    padding: 0 9px;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;

    &:hover {
      background: var(--other-btn-hover);
    }

    &:disabled {
      cursor: default;
      opacity: .48;
    }
  }

  .queue-item__mini_danger {
    color: var(--desc-color);
  }

  .queue-item_active {
    color: var(--text-color);
    background: var(--card-color);
    font-weight: 700;
  }

  .queue-index {
    color: var(--note-color);
  }

  .queue-title,
  .queue-artist {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .queue-artist {
    color: var(--note-color);
    text-align: right;
    font-size: 13px;
  }

  h2 {
    font-size: var(--title-font);
    color: var(--text-color);
    margin-block-start: 0;
    margin-block-end: 20px;
  }

  .room-listening {
    margin-block-start: 0;
    margin-block-end: 20px;
    width: 100%;
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;

    .rl-title {
      font-size: var(--title-font);
      color: var(--text-color);
      font-weight: 700;
      width: 60%;
      display: flex;
      flex-wrap: wrap;
      line-height: 32px;
    }

    .rl-mini-btn {
      display: flex;
      height: 32px;
      align-items: center;
      justify-content: center;
      background-color: var(--other-btn-bg);
      color: var(--other-btn-text);
      font-size: var(--mini-font);
      transition: .15s;
      cursor: pointer;
      border-radius: 30px;
      padding: 0 14px;
      min-width: 50px;
    }

    .rl-mini-btn:hover, .rl-mini-btn:active {
      background-color: var(--other-btn-hover);
    }

  }

  .room-participants {
    width: 100%;
    background-color: var(--card-color);
    box-sizing: border-box;
    padding: 20px 24px;
    border-radius: 20px;
    position: relative;

    .room-participant {
      flex: 1;
      display: flex;
      align-items: center;
      height: 80px;
      position: relative;
    }

    .rp-nickName {
      display: flex;
      max-width: 60%;
      font-size: var(--desc-font);
      line-height: 22px;
      color: var(--desc-color);
      padding-right: 10px;
      user-select: text;

      .rp-nickName-icon {
        width: 22px;
        height: 22px;
        margin-left: 6px;
        opacity: .56;
        background-image: v-bind("'url(' + (theme === 'light' ? images.IC_EDIT : images.IC_EDIT_DM) + ')'");
      }
    }

    .rp-nickName_pointer {
      cursor: pointer;
    }

    .rp-enter-time {
      flex: 1;
      display: flex;
      justify-content: flex-end;
      text-align: right;
      font-size: var(--mini-font);
      color: var(--note-color);
    }

  }

  .room-virtual-two {
    width: 100%;
    height: 130px;
  }

  @media screen and (max-width: 640px) {
    .room-virtual-one {
      display: none;
    }

    .room-virtual-two {
      height: 180px;
    }

    .queue-head {
      align-items: flex-start;
      flex-direction: column;
    }

    .queue-actions {
      justify-content: flex-start;
    }

    .playlist-import-panel__head {
      flex-wrap: wrap;
    }

    .queue-item {
      grid-template-columns: minmax(0, 1fr);
      gap: 4px;
    }

    .queue-item__main {
      grid-template-columns: 30px minmax(0, 1fr);
    }

    .queue-item__actions {
      justify-content: flex-start;
      padding-left: 30px;
    }

    .queue-artist {
      display: none;
    }
  }

  .room-btns {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-around;
    justify-content: space-evenly;
    position: relative;
    margin-top: 50px;

    .room-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 25px;
      height: 50px;
      width: 30%;
      min-width: 120px;
      transition: .15s;
      background-color: var(--other-btn-bg);
      color: var(--other-btn-text);
      font-size: var(--btn-font);
      cursor: pointer;

      .room-btn-icon {
        width: 20px;
        height: 20px;
        margin-right: 16px;
        opacity: v-bind("theme === 'light' ? .56 : .98");

        &.room-btn-icon_leave {
          background-image: v-bind("'url(' + (theme === 'light' ? images.IC_CLOSE : images.IC_CLOSE_DM) + ')'");
        }

        &.room-btn-icon_share {
          opacity: v-bind("theme === 'light' ? .98 : .66");
          background-image: v-bind("'url(' + (theme === 'light' ? images.IC_SHARE : images.IC_SHARE_DM) + ')'");
        }
      }

      &:hover {
        background-color: var(--other-btn-hover);
      }

      &.room-btn-main {
        background-color: var(--main-btn-bg);
        color: var(--main-btn-text);

        &:hover {
          background-color: var(--hover-btn-bg);
        }
      }
    }

  }

  .room-title-desc {
    margin-top: 50px;
    position: relative;
    width: 100%;

    .room-podcast-title {
      width: 100%;
      font-size: var(--title-font);
      color: var(--text-color);
      line-height: 1.5;
      font-weight: 700;
      margin-bottom: 10px;
      user-select: text;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: break-word;
      max-width: 100%;
    }

    .room-desc-box {
      width: 100%;
      background-color: var(--card-color);
      box-sizing: border-box;
      padding: 20px 24px;
      border-radius: 20px;
      position: relative;

      .room-description {
        position: relative;
        width: 100%;
        font-size: var(--desc-font);
        color: var(--desc-color);
        line-height: 1.75;
        white-space: pre-wrap;
        word-wrap: break-word;
        overflow-wrap: break-word;
        overflow: hidden;
        z-index: 10;
        user-select: text;
      }

      .room-desc-limited {
        /** 18px * 1.75行倍距 * 3行 */
        max-height: 95px;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
      }

      .room-desc_pointer {
        cursor: pointer;
      }

      .room-show-more {
        z-index: 15;
        display: flex;
        justify-content: center;
        align-items: center;
        position: relative;
        text-align: center;
        width: 100%;
        padding: 30px 0 5px;
        /** 18px * 1.75 然后再减掉 5 */
        margin-top: -27px;
        cursor: pointer;

        .room-show-more-text {
          font-size: var(--btn-font);
          color: var(--text-color);
          font-weight: 700;
          line-height: 1.5;
          z-index: 17;
        }

        .room-show-more-icon {
          width: 20px;
          height: 20px;
          margin-left: 4px;
          opacity: .8;
          z-index: 17;
          background-image: v-bind("'url(' + (theme === 'light' ? images.IC_EXPAND : images.IC_EXPAND_DM) + ')'");
        }

        .rsmi-rotated {
          transform: rotate(-90deg);
        }

        .room-show-more-bg {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 16;
          background: var(--more-btn-bg);
        }
      }

    }

  }

}

</style>

<!-- 全局 -->
<style>
.shk-cover {
  background-position: center;
}

.shk-bar_wrap {
  height: 14px;
  cursor: pointer;
}

.rp-player .shk {
  padding-bottom: 26px;
}

.rp-player .shk-bar_wrap {
  top: auto !important;
  bottom: 0;
  padding: 8px 0;
}

.rp-player .shk-display {
  top: auto !important;
  bottom: -18px;
}

.shk-bar {
  top: 5px;
}

.shk-bar-handle {
  cursor: grab;
}

.shk[data-seeking] .shk-bar-handle {
  cursor: grabbing;
}
</style>
