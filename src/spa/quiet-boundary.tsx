import { Component, type ReactNode } from "react";

/**
 * Ruling P300: a decoration that fails draws nothing, and the screen beside it keeps working. It catches a lazy chunk
 * that does not load (a deploy removed it from a long-open tab, a network drop) and a render that throws, which would
 * otherwise reach the route's error boundary and replace the whole screen, a half-typed record form included.
 */
export class QuietBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
