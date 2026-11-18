import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

// Charge des données du serveur pour un écran, avec les trois états que tout écran doit prévoir :
//   loading : première lecture en cours ; error : la lecture a échoué ; data : les données.
// Les données sont relues à chaque retour sur l'écran (on y voit tout de suite une création ou une modification),
// sans les effacer pendant la relecture : pas de clignotement.
//
//   const load = useCallback(() => getPublicEvents(), []);   // `load` change ⇒ nouvelle lecture (ex. autre collectif)
//   const { data, error, loading, reload } = useLoad(load);
//
// enabled = false : rien n'est lu (par exemple tant que personne n'est connecté).
export interface LoadState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void; // « Réessayer »
}

type Snapshot<T> = { owner: () => Promise<T>; data?: T; error?: unknown };

export function useLoad<T>(load: () => Promise<T>, enabled = true): LoadState<T> {
  const [snapshot, setSnapshot] = useState<Snapshot<T> | undefined>();
  const [version, setVersion] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      let active = true;
      load().then(
        (data) => {
          if (active) setSnapshot({ owner: load, data });
        },
        (error) => {
          // On garde les anciennes données s'il y en a : une relecture ratée ne doit pas vider l'écran.
          if (active) setSnapshot((previous) => ({ owner: load, data: previous?.owner === load ? previous.data : undefined, error }));
        }
      );
      return () => {
        active = false;
      };
      // `version` n'est pas lu ici : il change à chaque « Réessayer » (reload) pour relancer la lecture.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, enabled, version])
  );

  // Des données lues pour une autre demande (un autre collectif, par exemple) ne sont jamais montrées.
  const current = snapshot?.owner === load ? snapshot : undefined;

  return {
    data: current?.data,
    error: current?.error,
    loading: enabled && current === undefined,
    reload: () => {
      setSnapshot((previous) => (previous && previous.owner === load && previous.data !== undefined ? { owner: load, data: previous.data } : undefined));
      setVersion((count) => count + 1);
    },
  };
}
