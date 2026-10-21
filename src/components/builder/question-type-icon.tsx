import {
  AlignLeft,
  AtSign,
  Calendar,
  Camera,
  Grid3x3,
  ListOrdered,
  MapPin,
  CircleDot,
  Hash,
  ListChecks,
  Phone,
  SlidersHorizontal,
  SquareChevronDown,
  Star,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { QuestionType } from "@/lib/forms/schema";

export const QUESTION_TYPE_ICONS: Record<QuestionType, LucideIcon> = {
  short_text: Type,
  paragraph: AlignLeft,
  multiple_choice: CircleDot,
  checkboxes: ListChecks,
  dropdown: SquareChevronDown,
  number: Hash,
  date: Calendar,
  rating: Star,
  linear_scale: SlidersHorizontal,
  email: AtSign,
  phone: Phone,
  grid: Grid3x3,
  ranking: ListOrdered,
  location: MapPin,
  photo: Camera,
};

export function QuestionTypeIcon({
  type,
  className,
}: {
  type: QuestionType;
  className?: string;
}) {
  const Icon = QUESTION_TYPE_ICONS[type];
  return <Icon className={className ?? "size-4"} aria-hidden />;
}
