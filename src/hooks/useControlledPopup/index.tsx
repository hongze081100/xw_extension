import React, { ReactNode } from 'react';
import { Drawer, Modal } from 'antd';
import { usePopup } from './usePopup';
import { OpenDrawer, OpenModal } from './type';

export function useControlledModal(): [OpenModal, ReactNode] {
  const { open, options, footerNode, childrenNode, openFn, handleAfterClose, handleCancel } = usePopup();

  const modalNode = options ? (
    <Modal
      {...options}
      open={open}
      destroyOnHidden
      afterClose={handleAfterClose}
      footer={footerNode}
      onOk={undefined}
      onCancel={handleCancel}
    >
      {childrenNode}
    </Modal>
  ) : null;

  return [openFn as OpenModal, modalNode];
}

export function useControlledDrawer(): [OpenDrawer, ReactNode] {
  const { open, options, footerNode, childrenNode, openFn, handleAfterClose, handleCancel } = usePopup();

  const drawerNode = options ? (
    <Drawer
      {...(options as any)}
      open={open}
      destroyOnHidden
      afterOpenChange={(isOpen) => !isOpen && handleAfterClose()}
      footer={footerNode}
      onClose={handleCancel}
    >
      {childrenNode}
    </Drawer>
  ) : null;

  return [openFn as OpenDrawer, drawerNode];
}
