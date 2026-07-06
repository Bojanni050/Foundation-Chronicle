import {
  FileText,
  User,
  CheckSquare,
  Lightbulb,
  BookOpen,
  Folder,
  Calendar,
  Sun,
  MessageSquare,
} from "lucide-react";

export const OBJECT_TYPES = [
  { key: "note", label: "Notes", singular: "Note", icon: FileText },
  { key: "person", label: "People", singular: "Person", icon: User },
  { key: "task", label: "Tasks", singular: "Task", icon: CheckSquare },
  { key: "idea", label: "Ideas", singular: "Idea", icon: Lightbulb },
  { key: "book", label: "Books", singular: "Book", icon: BookOpen },
  { key: "project", label: "Projects", singular: "Project", icon: Folder },
  { key: "meeting", label: "Meetings", singular: "Meeting", icon: Calendar },
  { key: "dailyLog", label: "Daily Logs", singular: "Daily Log", icon: Sun },
  { key: "chat", label: "Chats", singular: "Chat", icon: MessageSquare },
];

export function typeMeta(key) {
  return OBJECT_TYPES.find((t) => t.key === key) || OBJECT_TYPES[0];
}
