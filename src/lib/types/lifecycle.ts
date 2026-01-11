/**
 * Interface for services that need initialization after all dependencies are resolved
 */
export interface OnInit {
  onInit(): Promise<void> | void;
}

/**
 * Interface for services that need cleanup on container destruction
 */
export interface OnDestroy {
  onDestroy(): Promise<void> | void;
}
