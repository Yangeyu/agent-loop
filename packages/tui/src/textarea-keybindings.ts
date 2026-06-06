const TEXTAREA_KEYBINDINGS = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "left", action: "move-left" },
  { name: "right", action: "move-right" },
  { name: "up", action: "move-up" },
  { name: "down", action: "move-down" },
  { name: "backspace", action: "backspace" },
  { name: "delete", action: "delete" },
  { name: "a", ctrl: true, action: "line-home" },
  { name: "e", ctrl: true, action: "line-end" },
  { name: "b", ctrl: true, action: "move-left" },
  { name: "f", ctrl: true, action: "move-right" },
  { name: "p", ctrl: true, action: "move-up" },
  { name: "n", ctrl: true, action: "move-down" },
  { name: "b", meta: true, action: "word-backward" },
  { name: "f", meta: true, action: "word-forward" },
  { name: "h", ctrl: true, action: "backspace" },
  { name: "d", ctrl: true, action: "delete" },
  { name: "u", ctrl: true, action: "delete-to-line-start" },
  { name: "k", ctrl: true, action: "delete-to-line-end" },
  { name: "backspace", meta: true, action: "delete-word-backward" },
  { name: "z", ctrl: true, action: "undo" },
  { name: "y", ctrl: true, action: "redo" },
] as const

export function getTextareaKeybindings() {
  return [...TEXTAREA_KEYBINDINGS]
}
