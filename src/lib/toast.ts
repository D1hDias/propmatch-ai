import { toast } from 'sonner';

export function toastError(message: string) {
  toast.error(message, { duration: 5000 });
}

export function toastSuccess(message: string) {
  toast.success(message, { duration: 3000 });
}

export function toastInfo(message: string) {
  toast.info(message, { duration: 4000 });
}
