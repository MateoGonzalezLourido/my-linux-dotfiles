import { SectionId } from "../../state"
import { HomeSection } from "./HomeSection"
import { AppsSection } from "./AppsSection"
import { KeybindsSection } from "./KeybindsSection"
import { ReactiveSection } from "./ReactiveSection"
import { GitSection } from "./GitSection"
import { RiceSection } from "./RiceSection"

export const SECTION_COMPONENTS: Partial<Record<SectionId, () => any>> = {
  inicio:   HomeSection,
  apps:     AppsSection,
  keybinds: KeybindsSection,
  reactivo: ReactiveSection,
  git:      GitSection,
  rice:     RiceSection,
}
