interface PhotoSlotsProps {
  photos: string[];
  active?: number;
}

export function PhotoSlots({ photos, active }: PhotoSlotsProps) {
  return (
    <div
      className="absolute bottom-[max(2rem,env(safe-area-inset-bottom))] left-1/2 z-10 flex -translate-x-1/2 gap-3 rounded-[2rem] bg-stone-950/35 p-3 shadow-2xl backdrop-blur-2xl sm:gap-4"
      role="status"
      aria-label={`${photos.length} of 3 photos captured`}
      aria-live="polite"
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className={`grid h-[5.5rem] w-[8.25rem] place-items-center overflow-hidden rounded-[1.35rem] bg-white/20 shadow-sm transition duration-300 sm:h-[6.75rem] sm:w-[10.25rem] lg:h-[7.75rem] lg:w-[11.75rem] ${
            active === index ? 'scale-[1.035] bg-stone-100/55' : ''
          } ${photos[index] ? 'bg-stone-50' : ''}`}
          aria-hidden="true"
        >
          {photos[index] ? (
            <img className="h-full w-full object-cover" src={photos[index]} alt="" width="376" height="248" />
          ) : null}
        </div>
      ))}
    </div>
  );
}
