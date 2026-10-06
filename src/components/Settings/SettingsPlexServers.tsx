import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import LibraryItem from '@app/components/Settings/LibraryItem';
import usePlexLogin from '@app/hooks/usePlexLogin';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import {
  ArrowPathIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import type { Library } from '@server/lib/settings';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import * as Yup from 'yup';

const messages = defineMessages('components.Settings.SettingsPlexServers', {
  plexServers: 'Additional Plex Servers',
  plexServersDescription:
    'Plex servers owned by other Plex accounts. Users shared on any configured server can sign in, and titles on any server count as available.',
  addServer: 'Add Plex Server',
  editServer: 'Edit Plex Server',
  deleteServer: 'Delete Plex Server',
  deleteServerConfirm:
    'Are you sure you want to delete this server? Titles found only on this server will be marked as removed at the next availability sync, unless Radarr or Sonarr still has them.',
  address: 'Address',
  ssl: 'SSL',
  hostname: 'Hostname or IP Address',
  port: 'Port',
  useSsl: 'Use SSL',
  webAppUrl: 'Web App URL',
  webAppUrlTip:
    'Optionally direct users to the web app on this server instead of the hosted web app',
  owner: 'Server Owner',
  ownerTip:
    'Sign in with the Plex account that owns this server; sign out of plex.tv first if your browser is signed in as another account',
  signInAsOwner: 'Sign In as Owner',
  signingIn: 'Signing In…',
  ownerSignedIn: 'Signed In',
  syncLibraries: 'Sync Libraries',
  syncing: 'Syncing…',
  validationHostnameRequired: 'You must provide a valid hostname or IP address',
  validationPortRequired: 'You must provide a valid port number',
  validationWebAppUrl: 'You must provide a valid URL',
  toastServerSaved: 'Plex server saved successfully!',
  toastNotOwner: 'The signed-in Plex account does not own this server.',
  toastDuplicate: 'This Plex server is already configured.',
  toastConnectionFailed: 'Failed to connect to the Plex server.',
  toastSignInFailed: 'Failed to sign in to Plex.',
  toastSyncFailed: 'Failed to sync libraries.',
  toastToggleFailed: 'Failed to toggle library.',
  toastDeleteFailed: 'Failed to delete the Plex server.',
});

interface PlexServer {
  id: number;
  name: string;
  machineId?: string;
  ip: string;
  port: number;
  useSsl?: boolean;
  webAppUrl?: string;
  libraries: Library[];
  hasOwnerToken: boolean;
}

interface PlexServerModalProps {
  server?: PlexServer;
  onClose: () => void;
  onSave: () => void;
}

const PlexServerModal = ({ server, onClose, onSave }: PlexServerModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [ownerToken, setOwnerToken] = useState<string>();
  const { loading: signingIn, login } = usePlexLogin({
    onAuthToken: (authToken) => setOwnerToken(authToken),
    onError: () =>
      addToast(intl.formatMessage(messages.toastSignInFailed), {
        autoDismiss: true,
        appearance: 'error',
      }),
  });

  const schema = Yup.object().shape({
    ip: Yup.string().required(
      intl.formatMessage(messages.validationHostnameRequired)
    ),
    port: Yup.number()
      .typeError(intl.formatMessage(messages.validationPortRequired))
      .required(intl.formatMessage(messages.validationPortRequired)),
    webAppUrl: Yup.string()
      .nullable()
      .url(intl.formatMessage(messages.validationWebAppUrl)),
  });

  const hasOwner = !!ownerToken || !!server?.hasOwnerToken;

  return (
    <Transition
      as="div"
      appear
      show
      enter="transition-opacity ease-in-out duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity ease-in-out duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <Formik
        initialValues={{
          ip: server?.ip ?? '',
          port: server?.port ?? 32400,
          useSsl: server?.useSsl ?? false,
          webAppUrl: server?.webAppUrl ?? '',
        }}
        validationSchema={schema}
        onSubmit={async (values) => {
          // An omitted owner token keeps the stored one.
          const body = {
            ip: values.ip,
            port: Number(values.port),
            useSsl: values.useSsl,
            webAppUrl: values.webAppUrl || undefined,
            ownerToken,
          };
          try {
            if (server) {
              await axios.put(
                `/api/v1/settings/plex/servers/${server.id}`,
                body
              );
            } else {
              await axios.post('/api/v1/settings/plex/servers', body);
            }
            addToast(intl.formatMessage(messages.toastServerSaved), {
              autoDismiss: true,
              appearance: 'success',
            });
            onSave();
          } catch (e) {
            const status = e?.response?.status;
            addToast(
              intl.formatMessage(
                status === 400
                  ? messages.toastNotOwner
                  : status === 409
                    ? messages.toastDuplicate
                    : messages.toastConnectionFailed
              ),
              { autoDismiss: true, appearance: 'error' }
            );
          }
        }}
      >
        {({ errors, touched, values, handleSubmit, isSubmitting, isValid }) => (
          <Modal
            onCancel={onClose}
            okButtonType="primary"
            okText={
              isSubmitting
                ? intl.formatMessage(globalMessages.saving)
                : intl.formatMessage(globalMessages.save)
            }
            okDisabled={!hasOwner || isSubmitting || !isValid}
            onOk={() => handleSubmit()}
            title={intl.formatMessage(
              server ? messages.editServer : messages.addServer
            )}
          >
            <div className="mb-6">
              <div className="form-row">
                <label className="text-label">
                  {intl.formatMessage(messages.owner)}
                  <span className="label-required">*</span>
                  <span className="label-tip">
                    {intl.formatMessage(messages.ownerTip)}
                  </span>
                </label>
                <div className="form-input-area flex items-center space-x-3">
                  <Button
                    type="button"
                    buttonType="ghost"
                    onClick={() => login()}
                    disabled={signingIn || isSubmitting}
                  >
                    <span>
                      {intl.formatMessage(
                        signingIn ? messages.signingIn : messages.signInAsOwner
                      )}
                    </span>
                  </Button>
                  {hasOwner && (
                    <Badge badgeType="success">
                      {intl.formatMessage(messages.ownerSignedIn)}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="ip" className="text-label">
                  {intl.formatMessage(messages.hostname)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <span className="protocol">
                      {values.useSsl ? 'https://' : 'http://'}
                    </span>
                    <Field
                      id="ip"
                      name="ip"
                      type="text"
                      inputMode="url"
                      className="rounded-r-only"
                    />
                  </div>
                  {errors.ip && touched.ip && (
                    <div className="error">{errors.ip}</div>
                  )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="port" className="text-label">
                  {intl.formatMessage(messages.port)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <Field
                    id="port"
                    name="port"
                    type="text"
                    inputMode="numeric"
                    className="short"
                  />
                  {errors.port && touched.port && (
                    <div className="error">{errors.port}</div>
                  )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="useSsl" className="checkbox-label">
                  {intl.formatMessage(messages.useSsl)}
                </label>
                <div className="form-input-area">
                  <Field type="checkbox" id="useSsl" name="useSsl" />
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="webAppUrl" className="text-label">
                  {intl.formatMessage(messages.webAppUrl)}
                  <span className="label-tip">
                    {intl.formatMessage(messages.webAppUrlTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      id="webAppUrl"
                      name="webAppUrl"
                      type="text"
                      inputMode="url"
                    />
                  </div>
                  {errors.webAppUrl && touched.webAppUrl && (
                    <div className="error">{errors.webAppUrl}</div>
                  )}
                </div>
              </div>
            </div>
          </Modal>
        )}
      </Formik>
    </Transition>
  );
};

const SettingsPlexServers = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data, error, mutate } = useSWR<PlexServer[]>(
    '/api/v1/settings/plex/servers'
  );
  const [editing, setEditing] = useState<{
    open: boolean;
    server?: PlexServer;
  }>({ open: false });
  const [deleting, setDeleting] = useState<PlexServer | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);

  const showError = (message: { id: string; defaultMessage: string }) =>
    addToast(intl.formatMessage(message), {
      autoDismiss: true,
      appearance: 'error',
    });

  const syncLibraries = async (server: PlexServer) => {
    setSyncingId(server.id);
    try {
      await axios.post(
        `/api/v1/settings/plex/servers/${server.id}/library/sync`
      );
    } catch {
      showError(messages.toastSyncFailed);
    } finally {
      setSyncingId(null);
      mutate();
    }
  };

  const toggleLibrary = async (server: PlexServer, library: Library) => {
    try {
      await axios.put(
        `/api/v1/settings/plex/servers/${server.id}/library/${library.id}`,
        { enabled: !library.enabled }
      );
    } catch {
      showError(messages.toastToggleFailed);
    } finally {
      mutate();
    }
  };

  const deleteServer = async () => {
    if (!deleting) {
      return;
    }
    try {
      await axios.delete(`/api/v1/settings/plex/servers/${deleting.id}`);
    } catch {
      showError(messages.toastDeleteFailed);
    } finally {
      setDeleting(null);
      mutate();
    }
  };

  return (
    <>
      {editing.open && (
        <PlexServerModal
          server={editing.server}
          onClose={() => setEditing({ open: false })}
          onSave={() => {
            setEditing({ open: false });
            mutate();
          }}
        />
      )}
      <Transition
        as="div"
        show={!!deleting}
        enter="transition-opacity ease-in-out duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity ease-in-out duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <Modal
          okText={intl.formatMessage(globalMessages.delete)}
          okButtonType="danger"
          onOk={() => deleteServer()}
          onCancel={() => setDeleting(null)}
          title={intl.formatMessage(messages.deleteServer)}
        >
          {intl.formatMessage(messages.deleteServerConfirm)}
        </Modal>
      </Transition>
      <div className="mb-6 mt-10">
        <h3 className="heading">{intl.formatMessage(messages.plexServers)}</h3>
        <p className="description">
          {intl.formatMessage(messages.plexServersDescription)}
        </p>
      </div>
      <div className="section">
        {!data && !error && <LoadingSpinner />}
        {data && (
          <ul className="grid grid-cols-1 gap-6">
            {data.map((server) => (
              <li
                key={`plex-server-${server.id}`}
                className="col-span-1 rounded-lg bg-gray-800 shadow ring-1 ring-gray-500"
              >
                <div className="p-6">
                  <div className="mb-2 flex items-center space-x-2">
                    <h3 className="truncate font-medium leading-5 text-white">
                      {server.name}
                    </h3>
                    {server.useSsl && (
                      <Badge badgeType="success">
                        {intl.formatMessage(messages.ssl)}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm leading-5 text-gray-300">
                    <span className="mr-2 font-bold">
                      {intl.formatMessage(messages.address)}
                    </span>
                    {`${server.useSsl ? 'https' : 'http'}://${server.ip}:${
                      server.port
                    }`}
                  </p>
                  <Button
                    className="mt-4"
                    buttonSize="sm"
                    onClick={() => syncLibraries(server)}
                    disabled={syncingId === server.id}
                  >
                    <ArrowPathIcon
                      className={syncingId === server.id ? 'animate-spin' : ''}
                      style={{ animationDirection: 'reverse' }}
                    />
                    <span>
                      {intl.formatMessage(
                        syncingId === server.id
                          ? messages.syncing
                          : messages.syncLibraries
                      )}
                    </span>
                  </Button>
                  <ul className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
                    {server.libraries.map((library) => (
                      <LibraryItem
                        key={`plex-server-${server.id}-library-${library.id}`}
                        name={library.name}
                        isEnabled={library.enabled}
                        onToggle={() => toggleLibrary(server, library)}
                      />
                    ))}
                  </ul>
                </div>
                <div className="border-t border-gray-500">
                  <div className="-mt-px flex">
                    <div className="flex w-0 flex-1 border-r border-gray-500">
                      <button
                        onClick={() => setEditing({ open: true, server })}
                        className="focus:ring-blue relative -mr-px inline-flex w-0 flex-1 items-center justify-center rounded-bl-lg border border-transparent py-4 text-sm font-medium leading-5 text-gray-200 transition duration-150 ease-in-out hover:text-white focus:z-10 focus:border-gray-500 focus:outline-none"
                      >
                        <PencilIcon className="mr-2 h-5 w-5" />
                        <span>{intl.formatMessage(globalMessages.edit)}</span>
                      </button>
                    </div>
                    <div className="-ml-px flex w-0 flex-1">
                      <button
                        onClick={() => setDeleting(server)}
                        className="focus:ring-blue relative inline-flex w-0 flex-1 items-center justify-center rounded-br-lg border border-transparent py-4 text-sm font-medium leading-5 text-gray-200 transition duration-150 ease-in-out hover:text-white focus:z-10 focus:border-gray-500 focus:outline-none"
                      >
                        <TrashIcon className="mr-2 h-5 w-5" />
                        <span>{intl.formatMessage(globalMessages.delete)}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button
          className="mt-6"
          buttonType="ghost"
          onClick={() => setEditing({ open: true })}
        >
          <PlusIcon />
          <span>{intl.formatMessage(messages.addServer)}</span>
        </Button>
      </div>
    </>
  );
};

export default SettingsPlexServers;
