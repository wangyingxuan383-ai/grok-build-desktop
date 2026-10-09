import React from "react";
import Ionicons from "@expo/vector-icons/Ionicons";

/**
 * One vector icon set for the whole app. Unicode glyphs (☰ ⋯ ★) render with different
 * weights, sizes or even as emoji depending on the phone maker's font; these do not.
 * Screens use semantic names so the set can change in one place.
 */
const names = {
    back: "chevron-back",
    forward: "chevron-forward",
    close: "close",
    add: "add",
    more: "ellipsis-horizontal",
    menu: "list",
    send: "arrow-up",
    stop: "stop",
    queue: "time-outline",
    attach: "attach",
    search: "search",
    star: "star",
    starOutline: "star-outline",
    archive: "archive-outline",
    unarchive: "arrow-undo-outline",
    trash: "trash-outline",
    copy: "copy-outline",
    quote: "chatbox-ellipses-outline",
    share: "share-social-outline",
    download: "download-outline",
    info: "information-circle-outline",
    check: "checkmark",
    checkCircle: "checkmark-circle",
    warning: "warning-outline",
    error: "alert-circle-outline",
    refresh: "refresh",
    settings: "settings-outline",
    computer: "desktop-outline",
    phone: "phone-portrait-outline",
    lock: "lock-closed-outline",
    unlock: "lock-open-outline",
    bell: "notifications-outline",
    bellOff: "notifications-off-outline",
    moon: "moon-outline",
    image: "image-outline",
    images: "images-outline",
    grid: "grid-outline",
    list: "list-outline",
    sessions: "chatbubbles-outline",
    tasks: "time-outline",
    pulse: "pulse-outline",
    swap: "swap-horizontal",
    bookmark: "bookmark-outline",
    bookmarkFilled: "bookmark",
    flash: "flash-outline",
    text: "text-outline",
    hand: "hand-left-outline",
    cloud: "cloud-download-outline",
    storage: "server-outline",
    wifi: "wifi-outline",
    shield: "shield-checkmark-outline",
    select: "checkbox-outline",
    selectCircle: "ellipse-outline",
    swapVertical: "swap-vertical",
    expand: "chevron-down",
    collapse: "chevron-up",
    play: "play",
    pause: "pause",
    calendar: "calendar-outline",
    folder: "folder-outline",
    edit: "create-outline",
    reply: "return-up-back-outline",
    eye: "eye-outline",
} as const;

export type IconName = keyof typeof names;

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
    return <Ionicons name={names[name]} size={size} color={color} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
