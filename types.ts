
export interface OfferPayload {
  sdp: RTCSessionDescriptionInit;
  fileName: string;
  fileSize: number;
  passwordHash?: string;
}

export type AppState =
  | "idle"
  | "generatingOffer"
  | "awaitingAnswer"
  | "processingOffer"
  | "awaitingPassword"
  | "generatingAnswer"
  | "connecting"
  | "transferring"
  | "transferComplete"
  | "error";
